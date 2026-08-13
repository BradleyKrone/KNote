// In-place table cell editing — click a cell in the rendered grid and type into
// it, the way Obsidian's Live Preview tables work. The table never drops back
// to raw pipes just because the caret arrived; it stays a rendered <table> and
// the *active cell* hosts its own small CodeMirror EditorView.
//
// Why a nested EditorView rather than a contenteditable cell: it's what buys
// [[link]] / #tag autocomplete, Ctrl+B/I, IME and native caret behavior inside a
// cell for free, all from extensions this editor already has.
//
// Three CodeMirror guarantees make a widget's interior genuinely opaque, and
// they're what make this safe:
//   - `WidgetType.ignoreEvent()` defaults to true, so every key typed in the
//     cell is dropped by the outer view before it reaches a keymap. The outer
//     Enter/Tab bindings never fire here. Do NOT override ignoreEvent.
//   - The outer DOMObserver discards all mutations inside widget DOM.
//   - The widget wrapper is contentEditable=false, so a contenteditable
//     descendant is its own HTML editing host with independent selection/IME.
//
// The one thing that has to be got right is keeping the nested view alive
// across the outer transaction fired on every keystroke. That's done in
// tableRender.ts: TableWidget.eq() masks out the active cell, so a keystroke
// inside it leaves the widget comparing equal and CodeMirror reuses the exact
// DOM node. Deliberately NOT WidgetType.updateDOM — CodeMirror matches widgets
// against a shared, position-blind bucket, so updateDOM can be handed a
// different table's DOM in the same note.
//
// Data flow is one-way: nested view -> outer document, one single-line change
// per keystroke (see tableCellLogic.commitPlan). The outer document is never
// written back into a live nested view. Any *external* change touching the
// table — host sync, a VS Code undo echo, a structural menu op — deactivates
// the cell rather than trying to reconcile against a live nested document.

import { completionKeymap } from '@codemirror/autocomplete'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import {
  Annotation,
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type Extension,
  type Transaction
} from '@codemirror/state'
import { EditorView, keymap, tooltips, type KeyBinding } from '@codemirror/view'
import { Autolink, Strikethrough, Table } from '@lezer/markdown'
import { knoteAutocomplete } from './completions'
import { formatKeymap } from './markdownFormatting'
import {
  cellText,
  commitPlan,
  nextCell,
  type ActiveCell,
  type CellDir,
  type CellMove
} from './tableCellLogic'
import {
  blankRowSource,
  parseGridText,
  parseTable,
  pasteGrid,
  roundTripsLossless,
  serializeTable,
  type ParsedTable
} from './tableModel'

export type { ActiveCell } from './tableCellLogic'

/** Activate a cell for editing, or pass null to leave the table. */
export const setActiveCell = StateEffect.define<ActiveCell | null>()

/** Show one table (by its start offset) as raw pipe source, or null for none. */
export const setTableSource = StateEffect.define<number | null>()

/**
 * Marks a transaction as the live cell session's own write-through, so the
 * session doesn't mistake its own echo for an external edit. An annotation
 * rather than a mutable flag: it survives across async and is readable from any
 * transaction.
 */
const cellCommit = Annotation.define<number>()

let nextSessionId = 1

/**
 * The table block containing `pos`, as whole lines. Shared with tableEdit.ts's
 * structural ops — it lives here so tableEdit can depend on this module rather
 * than the reverse.
 *
 * Both halves of that "whole lines" matter for an indented table (`indentTable`
 * in tableEdit.ts, nesting one under a task):
 *
 *  - the `Table` syntax node starts at the first `|`, *past* the indent, but
 *    every caller's `tableFrom` is a line start — that's what tableRender's
 *    replace decoration spans, what `posAtDOM` on the rendered widget answers,
 *    and what `cellRange` (tableCellLogic.ts) insists on. Returning the node's
 *    own `from` made the two disagree by exactly the indent width, so a
 *    right-click on an indented table resolved no table at all and the Table
 *    submenu vanished.
 *  - `pos` itself can land in the leading indent — a click in the rendered
 *    widget's left gutter, or a `tableFrom` line start — which is outside the
 *    node, so the search retries from the line's first non-blank character.
 */
export function findTableAt(
  state: EditorState,
  pos: number
): { from: number; to: number; raw: string } | null {
  return tableBlockAt(state, pos) ?? tableBlockAt(state, textStartOf(state, pos))
}

function tableBlockAt(
  state: EditorState,
  pos: number
): { from: number; to: number; raw: string } | null {
  for (let n = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent!) {
    if (n.name === 'Table') {
      const first = state.doc.lineAt(n.from)
      const last = state.doc.lineAt(Math.max(n.from, n.to - 1))
      return { from: first.from, to: last.to, raw: state.sliceDoc(first.from, last.to) }
    }
    if (!n.parent) break
  }
  return null
}

/** Offset of the first non-blank character on the line holding `pos`. */
function textStartOf(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos)
  return line.from + (/^[ \t]*/.exec(line.text)?.[0].length ?? 0)
}

function changeTouches(tr: Transaction, from: number, to: number): boolean {
  let hit = false
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (fromA <= to && toA >= from) hit = true
  })
  return hit
}

export const activeCellField = StateField.define<ActiveCell | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setActiveCell)) return e.value
    if (!value || !tr.docChanged) return value
    // Our own write-through moved the table only by the width of what was just
    // typed, so keep editing. Anything else touching this table ends the
    // session — reconciling an external edit against a live nested document is
    // where this design would go wrong.
    if (tr.annotation(cellCommit) !== value.id) {
      const found = findTableAt(tr.startState, value.tableFrom)
      if (!found || changeTouches(tr, found.from, found.to)) return null
    }
    const tableFrom = tr.changes.mapPos(value.tableFrom, -1)
    return tableFrom === value.tableFrom ? value : { ...value, tableFrom }
  }
})

export const tableSourceField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setTableSource)) return e.value
    if (value == null) return value
    const pos = tr.docChanged ? tr.changes.mapPos(value, -1) : value
    const found = findTableAt(tr.state, pos)
    if (!found) return null
    // Source view is a deliberate mode, not a hover state: it lasts until the
    // selection leaves the table.
    if (tr.selection) {
      const inside = tr.state.selection.ranges.some((r) => r.from <= found.to && r.to >= found.from)
      if (!inside) return null
    }
    return pos
  }
})

// ---------------------------------------------------------------------------
// The nested cell editor
// ---------------------------------------------------------------------------

interface Session {
  id: number
  view: EditorView
  disposed: boolean
}

/** At most one cell is editable at a time. */
let session: Session | null = null

/**
 * Where the click that activated a cell landed, so the caret can be dropped at
 * that point rather than at the end of the text. Consumed once, on mount.
 */
let pendingClick: { x: number; y: number } | null = null

export function setPendingCellClick(x: number, y: number): void {
  pendingClick = { x, y }
}

function disposeSession(): void {
  if (!session) return
  const done = session
  session = null
  done.disposed = true
  done.view.destroy()
}

/**
 * Tear down the cell editor living inside `dom`, if it's the live one. Called
 * from TableWidget.destroy — including when CodeMirror swaps a table scrolled
 * out of the viewport for a block gap. Keyed on the DOM rather than on the
 * widget instance: CodeMirror reuses a widget's DOM under a *different* widget
 * object whenever the two compare equal, which is the normal case here, so no
 * single instance can be trusted to still own the session.
 */
export function disposeCellSessionIn(dom: HTMLElement): void {
  if (session && dom.contains(session.view.dom)) disposeSession()
}

/** Close any live cell editor and clear the active cell. */
function deactivate(outer: EditorView, opts: { repad?: boolean } = {}): void {
  disposeSession()
  const active = outer.state.field(activeCellField, false)
  if (!active) return
  if (opts.repad) {
    const found = findTableAt(outer.state, active.tableFrom)
    // Re-padding runs the table through parseTable, which drops cells beyond
    // the header count per the GFM spec. Only tidy up when that's provably a
    // no-op, so merely typing in a cell can never delete data.
    if (found && roundTripsLossless(found.raw)) {
      const tidy = serializeTable(parseTable(found.raw))
      if (tidy !== found.raw) {
        outer.dispatch({
          changes: { from: found.from, to: found.to, insert: tidy },
          effects: setActiveCell.of(null)
        })
        return
      }
    }
  }
  outer.dispatch({ effects: setActiveCell.of(null) })
}

/** Commit and close any live cell editor — for callers about to rewrite a table. */
export function commitActiveCell(view: EditorView): void {
  deactivate(view)
}

/** Start (or move) the cell editor, optionally in the same transaction as a change. */
export function activateCell(
  outer: EditorView,
  cell: { tableFrom: number; row: number; col: number },
  changes?: { from: number; to?: number; insert: string }
): void {
  outer.dispatch({
    changes,
    effects: setActiveCell.of({ ...cell, id: nextSessionId++ })
  })
}

/** Put the caret back in the document, before or after the table, and leave. */
function exitTable(outer: EditorView, where: 'before' | 'after'): boolean {
  const active = outer.state.field(activeCellField, false)
  const tableFrom = active?.tableFrom ?? null
  deactivate(outer, { repad: true })
  // Re-resolve after deactivating: the tidy-up pass may have re-padded the
  // table, which moves its end.
  const found = tableFrom == null ? null : findTableAt(outer.state, tableFrom)
  if (found) {
    const at = where === 'before' ? Math.max(0, found.from - 1) : found.to
    outer.dispatch({ selection: EditorSelection.cursor(at), scrollIntoView: true })
  }
  outer.focus()
  return true
}

/** Append a blank row to the table and land on it at `col`. */
function appendRow(outer: EditorView, active: ActiveCell, col: number): boolean {
  const found = findTableAt(outer.state, active.tableFrom)
  if (!found) return exitTable(outer, 'after')
  const table = parseTable(found.raw)
  // Append a line rather than re-serializing the table: every existing row stays
  // byte-identical, so growing a table can never trip parseTable's
  // drop-the-extra-cells behavior.
  activateCell(
    outer,
    { tableFrom: active.tableFrom, row: table.rows.length, col },
    { from: found.to, insert: `\n${blankRowSource(table)}` }
  )
  return true
}

function move(outer: EditorView, dir: CellDir, appendOnOverflow: boolean): boolean {
  const active = outer.state.field(activeCellField, false)
  if (!active) return false
  const found = findTableAt(outer.state, active.tableFrom)
  if (!found) return exitTable(outer, 'after')
  const table: ParsedTable = parseTable(found.raw)
  const to: CellMove = nextCell(
    { cols: table.header.length, rows: table.rows.length },
    active.row,
    active.col,
    dir,
    appendOnOverflow
  )
  if (to.kind === 'exit') return exitTable(outer, to.where)
  if (to.kind === 'append') return appendRow(outer, active, to.col)
  activateCell(outer, { tableFrom: active.tableFrom, row: to.row, col: to.col })
  return true
}

/** Arrow keys only leave a cell from its edge — inside, they move the caret. */
function atStart(view: EditorView): boolean {
  const { main } = view.state.selection
  return main.empty && main.head === 0
}
function atEnd(view: EditorView): boolean {
  const { main } = view.state.selection
  return main.empty && main.head === view.state.doc.length
}

function cellKeymap(outer: EditorView): KeyBinding[] {
  return [
    { key: 'Tab', run: () => move(outer, 'next', true) },
    { key: 'Shift-Tab', run: () => move(outer, 'prev', false) },
    { key: 'Enter', run: () => move(outer, 'down', true) },
    // Markdown's own in-cell line break — buildTable renders <br> as a real one.
    {
      key: 'Shift-Enter',
      run: (v) => {
        v.dispatch(v.state.replaceSelection('<br>'), { userEvent: 'input' })
        return true
      }
    },
    { key: 'Escape', run: () => exitTable(outer, 'after') },
    { key: 'ArrowRight', run: (v) => (atEnd(v) ? move(outer, 'next', false) : false) },
    { key: 'ArrowLeft', run: (v) => (atStart(v) ? move(outer, 'prev', false) : false) },
    { key: 'ArrowDown', run: () => move(outer, 'down', false) },
    { key: 'ArrowUp', run: () => move(outer, 'up', false) }
  ]
}

/**
 * A spreadsheet-shaped paste (tab-separated columns, one line per row) fills the
 * cells around the caret and grows the table to fit. Anything else — including a
 * table whose rows carry more cells than its header, which re-serializing would
 * truncate — falls through to an ordinary in-cell paste.
 */
function gridPaste(outer: EditorView, event: ClipboardEvent): boolean {
  const active = outer.state.field(activeCellField, false)
  if (!active) return false
  const grid = parseGridText(event.clipboardData?.getData('text/plain') ?? '')
  if (!grid) return false
  const found = findTableAt(outer.state, active.tableFrom)
  if (!found || !roundTripsLossless(found.raw)) return false
  const grown = pasteGrid(parseTable(found.raw), active.row, active.col, grid)
  event.preventDefault()
  disposeSession()
  activateCell(
    outer,
    { tableFrom: active.tableFrom, row: active.row, col: active.col },
    { from: found.from, to: found.to, insert: serializeTable(grown) }
  )
  return true
}

function cellExtensions(outer: EditorView, sessionId: number): Extension[] {
  return [
    // Completion keys first, so Escape dismisses an open [[link]] popup before
    // it exits the cell — the same reasoning as setupEditor.ts's keymap order.
    Prec.highest(keymap.of(completionKeymap)),
    Prec.highest(keymap.of(cellKeymap(outer))),
    keymap.of(formatKeymap),
    markdown({ extensions: [Strikethrough, Table, Autolink] }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    knoteAutocomplete,
    // The completion popup would otherwise be clipped by the table wrap's
    // overflow-x and by the cell's own box.
    tooltips({ parent: document.body, position: 'fixed' }),
    EditorView.contentAttributes.of({
      spellcheck: 'false',
      autocorrect: 'off',
      autocapitalize: 'off'
    }),
    // A cell is one line, always. The keymap covers a typed Enter; this covers
    // paste, IME and drag-and-drop.
    EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr)),
    EditorView.domEventHandlers({ paste: (e) => gridPaste(outer, e) }),
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return
      const active = outer.state.field(activeCellField, false)
      if (!active || active.id !== sessionId) return
      const plan = commitPlan(outer.state, active, u.state.doc.toString())
      if (plan) outer.dispatch({ changes: plan, annotations: cellCommit.of(sessionId) })
    })
    // No history(): Ctrl+Z must reach VS Code, which owns the undo stack.
  ]
}

/**
 * Mount the cell editor into `cell`, seeded from the document. Called from
 * TableWidget.toDOM when the widget being built is the active table's;
 * disposeCellSessionIn tears it down again.
 */
export function mountCellEditor(outer: EditorView, cell: HTMLElement, active: ActiveCell): void {
  disposeSession()
  const host = document.createElement('div')
  host.className = 'cm-md-table-cell-editor'
  cell.textContent = ''
  cell.appendChild(host)

  const view = new EditorView({
    state: EditorState.create({
      doc: cellText(outer.state, active.tableFrom, active.row, active.col) ?? '',
      extensions: cellExtensions(outer, active.id)
    }),
    parent: host
  })
  const mine: Session = { id: active.id, view, disposed: false }
  session = mine

  // Focus once the outer view has finished its update — focusing from inside
  // toDOM would run mid-layout.
  const click = pendingClick
  pendingClick = null
  requestAnimationFrame(() => {
    if (mine.disposed || session !== mine) return
    view.focus()
    const at = click ? view.posAtCoords(click) : null
    view.dispatch({ selection: EditorSelection.cursor(at ?? view.state.doc.length) })
  })
}

/**
 * A click on ordinary document text ends the session. Clicks inside a table
 * widget never reach here (the outer view drops events belonging to a widget) —
 * those are handled by the cell's own mousedown in tableRender.ts.
 */
const outerClicks = EditorView.domEventHandlers({
  mousedown: (_event, view) => {
    if (view.state.field(activeCellField, false)) deactivate(view, { repad: true })
    return false
  }
})

export const tableCellEdit: Extension = [activeCellField, tableSourceField, outerClicks]
