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
// "Edit table source", or when a non-empty selection covers the table — without
// that second case a find/replace hit inside a table would highlight text the
// user can't see.

import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
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
import { maskActiveCell } from './tableCellLogic'
import { cellOffsets, columnWidths, parseTable, type Align } from './tableModel'

/** A cell's markdown `<br>` breaks, split out so they render as real ones. */
const BR = /<br\s*\/?>/i

function sameCell(a: ActiveCell | null, b: ActiveCell | null): boolean {
  if (!a || !b) return a === b
  return a.id === b.id && a.row === b.row && a.col === b.col
}

class TableWidget extends WidgetType {
  constructor(
    private readonly raw: string,
    private readonly active: ActiveCell | null
  ) {
    super()
  }

  eq(other: TableWidget): boolean {
    return (
      sameCell(other.active, this.active) &&
      maskActiveCell(other.raw, other.active) === maskActiveCell(this.raw, this.active)
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-table-wrap'
    const table = buildTable(this.raw)
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

/** Fill a cell, turning markdown's `<br>` into real line breaks. */
function fillCell(el: HTMLElement, text: string, align: Align | undefined): void {
  text.split(BR).forEach((part, i) => {
    if (i > 0) el.appendChild(document.createElement('br'))
    el.appendChild(document.createTextNode(part))
  })
  if (align) el.style.textAlign = align
}

function buildTable(raw: string): HTMLTableElement {
  const { header, aligns, rows } = parseTable(raw)
  const table = document.createElement('table')
  table.className = 'cm-md-rendered-table'
  if (header.length === 0) return table

  const thead = document.createElement('thead')
  const htr = document.createElement('tr')
  header.forEach((cell, i) => {
    const th = document.createElement('th')
    fillCell(th, cell, aligns[i])
    htr.appendChild(th)
  })
  thead.appendChild(htr)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  for (const cells of rows) {
    const tr = document.createElement('tr')
    cells.forEach((cell, i) => {
      const td = document.createElement('td')
      fillCell(td, cell, aligns[i])
      tr.appendChild(td)
    })
    tbody.appendChild(tr)
  }
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

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return undefined
      const firstNum = doc.lineAt(node.from).number
      const lastNum = doc.lineAt(Math.max(node.from, node.to - 1)).number
      const first = doc.line(firstNum)
      const last = doc.line(lastNum)

      // A bare caret never reveals the source — that's the whole point of
      // editing cells in place. An explicit "Edit table source", or a non-empty
      // selection covering the table (a search hit, a drag-select), does.
      const showSource =
        (sourceAt != null && sourceAt >= first.from && sourceAt <= last.to) ||
        state.selection.ranges.some((r) => !r.empty && r.from <= last.to && r.to >= first.from)

      if (showSource) {
        // Keep the raw pipes, but hold each column to a fixed width via mark
        // decorations so it still reads as a table while being typed into —
        // padding the raw text itself would fight the user's cursor position.
        const raw = doc.sliceString(first.from, last.to)
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
        const raw = doc.sliceString(first.from, last.to)
        const cell = active && active.tableFrom === first.from ? active : null
        decorations.push(
          Decoration.replace({
            widget: new TableWidget(raw, cell),
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
      tr.effects.some((e) => e.is(setActiveCell) || e.is(setTableSource))
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
