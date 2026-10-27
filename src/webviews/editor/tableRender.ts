// Renders GFM pipe tables as real HTML <table> grids in the live-preview
// editor — the one construct where styled raw text can't approach the look of
// VS Code's built-in Markdown preview.
//
// Block widgets and line-crossing replace decorations can't be supplied by a
// ViewPlugin (the view needs them before it lays out content), so this lives
// in a StateField.
//
// Unlike every other construct here, a table does NOT fall back to raw source
// when the caret arrives: click a cell and type into the grid instead (see
// tableCellEdit.ts). The table block is atomic so the caret can't land inside
// it, and raw pipes appear only when explicitly asked for via the right-click
// "Edit table source", or when a non-empty selection spans more than one cell.
// A selection inside a single cell — a find/replace hit, above all — keeps the
// grid rendered and is painted onto the cell text instead, along with every
// other search match in the table (tableSearchLogic.ts), since CodeMirror's own
// match highlighter can't reach text a widget has replaced.

import { syntaxTree } from '@codemirror/language'
import { EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { getSearchQuery, searchPanelOpen } from '@codemirror/search'
import {
  activateCell,
  activeCellField,
  disposeCellSessionIn,
  mountCellEditor,
  setActiveCell,
  setPendingCellClick,
  setTableSource,
  tableSourceField,
  type ActiveCell
} from './tableCellEdit'
import { leadingColumns, SPACE_EM } from './hangingIndent'
import { enclosingGroupLastLine } from './taskFold'
import { maskActiveCell } from './tableCellLogic'
import { cellOffsets, columnWidths, parseTable, type Align } from './tableModel'
import {
  cellHighlights,
  withinOneCell,
  type CellHighlight,
  type RawHighlight
} from './tableSearchLogic'

/** A cell's markdown `<br>` breaks, split out so they render as real ones. */
const BR = /<br\s*\/?>/gi

/** Past this many search hits in one table, the rest go unpainted — keeps a pathological query cheap. */
const MAX_TABLE_HITS = 1000

/** Search hits per rendered cell, keyed `"row:col"` (tableSearchLogic.cellHighlights). */
type CellHits = Map<string, CellHighlight[]>

function hitsKey(hits: CellHits): string {
  let key = ''
  for (const [cell, list] of hits) {
    key += `${cell}=`
    for (const h of list) key += `${h.from}-${h.to}${h.selected ? '*' : ''},`
    key += ';'
  }
  return key
}

/**
 * The table block's own leading whitespace — from `indentTable` (tableEdit.ts)
 * nesting it under a task, or hand-typed — in em, the same space-width used
 * for hanging indent. Needed because the widget below replaces the block's
 * raw text wholesale, so any indentation in the source would otherwise be
 * silently swallowed rather than rendered: unlike ordinary text, where leading
 * spaces are just glyphs that push the line right on their own, nothing here
 * paints them for us.
 */
export function leadingIndentEm(raw: string, tabSize = 4): number {
  const indent = /^[ \t]*/.exec(raw)?.[0] ?? ''
  return indent ? leadingColumns(indent, tabSize) * SPACE_EM : 0
}

function sameCell(a: ActiveCell | null, b: ActiveCell | null): boolean {
  if (!a || !b) return a === b
  return a.id === b.id && a.row === b.row && a.col === b.col
}

/** Whether a table falls inside a task's group card, and whether it closes it. */
export interface TableGroupInfo {
  isLast: boolean
}

function sameGroup(a: TableGroupInfo | null, b: TableGroupInfo | null): boolean {
  if (!a || !b) return a === b
  return a.isLast === b.isLast
}

class TableWidget extends WidgetType {
  constructor(
    private readonly raw: string,
    private readonly active: ActiveCell | null,
    private readonly group: TableGroupInfo | null,
    // Captured at build time, not read from `view.state` in toDOM: eq() has to
    // know a tabSize change (Vault Settings, reaching an already-open editor)
    // makes two otherwise-identical widgets unequal, or CodeMirror reuses the
    // stale DOM and toDOM never runs again to repaint the indent.
    private readonly tabSize: number,
    private readonly hits: CellHits
  ) {
    super()
    this.hitsSig = hitsKey(hits)
  }

  private readonly hitsSig: string

  eq(other: TableWidget): boolean {
    return (
      sameCell(other.active, this.active) &&
      sameGroup(other.group, this.group) &&
      other.tabSize === this.tabSize &&
      other.hitsSig === this.hitsSig &&
      maskActiveCell(other.raw, other.active) === maskActiveCell(this.raw, this.active)
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-table-wrap'
    // The widget replaces the block's raw text wholesale, so unlike ordinary
    // text it can't pick up buildGroupBoxes's per-line `cm-knote-group-*`
    // decorations (there's no `.cm-line` left for them to attach to) — apply
    // the same classes here so a table nested under a task still reads as
    // part of that task's card instead of dropping out of it.
    let indentEm = leadingIndentEm(this.raw, this.tabSize)
    if (this.group) {
      wrap.classList.add('cm-knote-group-line')
      if (this.group.isLast) wrap.classList.add('cm-knote-group-last')
      indentEm += 0.7 // matches --knote-group-line's own padding-left
    }
    if (indentEm) wrap.style.paddingLeft = `${indentEm}em`
    const table = buildTable(this.raw, this.hits)
    wrap.appendChild(table)

    wrap.addEventListener('mousedown', (e) => {
      // A right-click only opens the context menu, which reads the clicked cell
      // straight off this DOM (see tableEdit.readTableCtx). Activating a cell
      // here would rebuild this widget out from under the contextmenu event
      // that follows, leaving the menu to guess at which cell was clicked.
      if (e.button !== 0) return
      const target = e.target as HTMLElement | null
      // Inside the live cell editor the nested view owns the click — touching it
      // here would break caret placement and drag-selection within the cell.
      if (target?.closest('.cm-md-table-cell-editor')) return
      e.preventDefault()
      // Read the table's offset from the DOM rather than remembering it: this
      // widget instance may have been built before an edit elsewhere in the
      // note shifted the table down.
      const tableFrom = view.posAtDOM(wrap)
      const cell = target?.closest('td, th') as HTMLTableCellElement | null
      if (!cell) {
        // The wrap's own padding: park the caret at the table's edge rather
        // than swallowing the click.
        view.dispatch({ selection: { anchor: tableFrom } })
        view.focus()
        return
      }
      const inHeader = cell.closest('thead') != null
      const tr = inHeader ? null : cell.closest('tr')
      if (!inHeader && !tr) return
      const row = tr ? tr.sectionRowIndex : -1
      setPendingCellClick(e.clientX, e.clientY)
      activateCell(view, { tableFrom, row, col: cell.cellIndex })
    })

    if (this.active) {
      const host = cellElement(table, this.active.row, this.active.col)
      if (host) mountCellEditor(view, host, this.active)
    }
    return wrap
  }

  destroy(dom: HTMLElement): void {
    // Covers CodeMirror swapping this table for a block gap when it scrolls out
    // of the viewport, as well as ordinary teardown.
    disposeCellSessionIn(dom)
  }
}

function cellElement(table: HTMLTableElement, row: number, col: number): HTMLElement | null {
  const tr = row < 0 ? table.tHead?.rows[0] : table.tBodies[0]?.rows[row]
  return (tr?.cells[col] as HTMLElement | undefined) ?? null
}

/**
 * Append `text[from, to)` to `el`, wrapping whatever the search hits cover in
 * the same `cm-searchMatch` spans CodeMirror's highlighter draws, so a hit in
 * a rendered cell looks exactly like one in ordinary text.
 */
function appendText(
  el: HTMLElement,
  text: string,
  from: number,
  to: number,
  hits: readonly CellHighlight[]
): void {
  let pos = from
  for (const h of hits) {
    const a = Math.max(h.from, pos)
    const b = Math.min(h.to, to)
    if (a >= b) continue
    if (a > pos) el.appendChild(document.createTextNode(text.slice(pos, a)))
    const mark = document.createElement('span')
    mark.className = h.selected ? 'cm-searchMatch cm-searchMatch-selected' : 'cm-searchMatch'
    mark.textContent = text.slice(a, b)
    el.appendChild(mark)
    pos = b
  }
  if (pos < to) el.appendChild(document.createTextNode(text.slice(pos, to)))
}

/** Fill a cell, turning markdown's `<br>` into real line breaks and painting any search hits. */
function fillCell(
  el: HTMLElement,
  text: string,
  align: Align | undefined,
  hits: readonly CellHighlight[] = []
): void {
  const sorted = [...hits].sort((a, b) => a.from - b.from)
  let pos = 0
  for (const br of text.matchAll(BR)) {
    appendText(el, text, pos, br.index, sorted)
    el.appendChild(document.createElement('br'))
    pos = br.index + br[0].length
  }
  appendText(el, text, pos, text.length, sorted)
  if (align) el.style.textAlign = align
}

function buildTable(raw: string, hits: CellHits): HTMLTableElement {
  const { header, aligns, rows } = parseTable(raw)
  const table = document.createElement('table')
  table.className = 'cm-md-rendered-table'
  if (header.length === 0) return table

  const thead = document.createElement('thead')
  const htr = document.createElement('tr')
  header.forEach((cell, i) => {
    const th = document.createElement('th')
    fillCell(th, cell, aligns[i], hits.get(`-1:${i}`))
    htr.appendChild(th)
  })
  thead.appendChild(htr)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  rows.forEach((cells, r) => {
    const tr = document.createElement('tr')
    cells.forEach((cell, i) => {
      const td = document.createElement('td')
      fillCell(td, cell, aligns[i], hits.get(`${r}:${i}`))
      tr.appendChild(td)
    })
    tbody.appendChild(tr)
  })
  table.appendChild(tbody)
  return table
}

interface TableDecorations {
  deco: DecorationSet
  /** The rendered tables' block ranges — the caret is kept out of these. */
  atoms: DecorationSet
}

function buildDecorations(state: EditorState): TableDecorations {
  const decorations: Range<Decoration>[] = []
  const atoms: Range<Decoration>[] = []
  const { doc } = state
  const active: ActiveCell | null = state.field(activeCellField, false) ?? null
  const sourceAt = state.field(tableSourceField, false) ?? null
  const query = getSearchQuery(state)
  const searching = searchPanelOpen(state) && query.search !== '' && query.valid

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return undefined
      const firstNum = doc.lineAt(node.from).number
      const lastNum = doc.lineAt(Math.max(node.from, node.to - 1)).number
      const first = doc.line(firstNum)
      const last = doc.line(lastNum)

      const raw = doc.sliceString(first.from, last.to)
      // A bare caret never reveals the source — that's the whole point of
      // editing cells in place. An explicit "Edit table source", or a non-empty
      // selection reaching past one cell (a drag-select), does. A selection
      // inside a single cell — what Ctrl+F's find-next lands on — stays rendered
      // and is painted on the cell instead.
      const touching = state.selection.ranges.filter(
        (r) => !r.empty && r.from <= last.to && r.to >= first.from
      )
      const showSource =
        (sourceAt != null && sourceAt >= first.from && sourceAt <= last.to) ||
        touching.some((r) => !withinOneCell(raw, r.from - first.from, r.to - first.from))

      if (showSource) {
        // Keep the raw pipes, but hold each column to a fixed width via mark
        // decorations so it still reads as a table while being typed into —
        // padding the raw text itself would fight the user's cursor position.
        const widths = columnWidths(parseTable(raw))
        for (let n = firstNum; n <= lastNum; n++) {
          const line = doc.line(n)
          const isHeader = n === firstNum
          const isDelim = !isHeader && /^[\s|:-]+$/.test(line.text)
          let c = 'cm-md-table-line'
          if (isHeader) c += ' cm-md-table-header'
          else if (isDelim) c += ' cm-md-table-delim'
          decorations.push(Decoration.line({ class: c }).range(line.from))

          if (!isDelim) {
            cellOffsets(line.text).forEach((cell, i) => {
              if (i >= widths.length || cell.to <= cell.from) return
              decorations.push(
                Decoration.mark({
                  class: 'cm-md-table-cell-inline',
                  attributes: { style: `min-width:${widths[i]}ch` }
                }).range(line.from + cell.from, line.from + cell.to)
              )
            })
          }
        }
      } else {
        const hits: RawHighlight[] = touching.map((r) => ({
          from: r.from - first.from,
          to: r.to - first.from,
          selected: true
        }))
        if (searching) {
          const cursor = query.getCursor(state, first.from, last.to)
          let n = 0
          for (let m = cursor.next(); !m.done && n < MAX_TABLE_HITS; m = cursor.next(), n++) {
            const from = m.value.from - first.from
            const to = m.value.to - first.from
            // The selected match is already in from the selection above.
            if (!hits.some((h) => h.from === from && h.to === to)) {
              hits.push({ from, to, selected: false })
            }
          }
        }
        const cell = active && active.tableFrom === first.from ? active : null
        const groupLastLine = enclosingGroupLastLine(state, firstNum)
        const group =
          groupLastLine != null && groupLastLine >= lastNum
            ? { isLast: groupLastLine === lastNum }
            : null
        decorations.push(
          Decoration.replace({
            widget: new TableWidget(
              raw,
              cell,
              group,
              state.facet(EditorState.tabSize),
              cellHighlights(raw, hits)
            ),
            block: true
          }).range(first.from, last.to)
        )
        atoms.push(Decoration.mark({}).range(first.from, last.to))
      }
      return false // don't descend into cells
    }
  })

  return { deco: Decoration.set(decorations, true), atoms: Decoration.set(atoms, true) }
}

export const tableRender = StateField.define<TableDecorations>({
  create: (state) => buildDecorations(state),
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      // The background parser (and foldPersist's forceParsing) publishes a
      // longer tree in a transaction that touches neither doc nor selection —
      // without this, a table past the ~3000-char initial parse stays raw
      // pipes until the caret happens to move.
      syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
      tr.effects.some((e) => e.is(setActiveCell) || e.is(setTableSource)) ||
      // Find: a new query, or the widget opening/closing, repaints the hits
      // painted onto rendered cells.
      getSearchQuery(tr.startState) !== getSearchQuery(tr.state) ||
      searchPanelOpen(tr.startState) !== searchPanelOpen(tr.state) ||
      // A tabSize reconfigure (Vault Settings) needs every indented table's
      // widget rebuilt: its leading padding is baked in at build time, and
      // WidgetType.eq() (keyed on raw/active/group, not tabSize) would
      // otherwise tell CodeMirror to keep reusing the stale DOM.
      tr.startState.facet(EditorState.tabSize) !== tr.state.facet(EditorState.tabSize)
    ) {
      return buildDecorations(tr.state)
    }
    return value
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    // A function, not a set: the facet is called with the view. Only the
    // rendered tables go in — making the source view's cell marks atomic would
    // break the escape hatch it exists to provide.
    EditorView.atomicRanges.of((view) => view.state.field(f).atoms)
  ]
})
