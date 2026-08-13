// Structural table edits for the right-click menu: insert a fresh table at
// the caret, or insert/delete the row or column under a click on an
// existing one. Every op rewrites the whole table block (parse -> transform
// -> serialize -> one dispatch), which keeps columns padded/aligned but also
// means stray extra cells beyond the header count (silently dropped today by
// parseTable, per the GFM spec) are dropped for good the first time a table
// with that quirk is touched here.

import { indentLess, indentMore } from '@codemirror/commands'
import { EditorSelection, type EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { activateCell, findTableAt } from './tableCellEdit'
import {
  columnAtOffset,
  emptyTableSource,
  insertTableColumn,
  insertTableRow,
  parseTable,
  removeTableColumn,
  removeTableRow,
  serializeTable,
  type ParsedTable
} from './tableModel'

export interface TableCtx {
  tableFrom: number
  tableTo: number
  table: ParsedTable
  /** -1 for the header/delimiter line, otherwise a 0-based index into `table.rows`. */
  rowIndex: number
  colIndex: number
}

/**
 * The row/column a rendered grid's `<td>`/`<th>` stands for, resolved against
 * the table that actually lives at `tableFrom` in the document. Null when the
 * cell isn't in a row at all — never a silent "row 0", which is how a lookup
 * miss used to end up editing the top of the table.
 */
export function tableCtxFromCell(
  state: EditorState,
  tableFrom: number,
  cell: HTMLTableCellElement
): TableCtx | null {
  const found = findTableAt(state, tableFrom)
  if (!found) return null
  const table = parseTable(found.raw)
  let rowIndex = -1
  if (cell.closest('thead') == null) {
    const tr = cell.closest('tr')
    if (!tr) return null
    // Clamp against the parsed table, not the DOM: the two can disagree if the
    // document moved on since this widget was built, and an out-of-range row
    // would make Delete row a silent no-op (see removeTableRow).
    rowIndex = Math.min(tr.sectionRowIndex, table.rows.length - 1)
  }
  const colIndex = Math.min(cell.cellIndex, Math.max(table.header.length - 1, 0))
  return { tableFrom: found.from, tableTo: found.to, table, rowIndex, colIndex }
}

/** The row/column at `pos` in a table shown as raw pipe text. */
export function tableCtxFromSource(state: EditorState, pos: number): TableCtx | null {
  const found = findTableAt(state, pos)
  if (!found) return null
  const table = parseTable(found.raw)
  const line = state.doc.lineAt(pos)
  const startLine = state.doc.lineAt(found.from).number
  const lineOffset = line.number - startLine // 0 = header, 1 = delimiter, 2+ = data row
  const rowIndex = lineOffset < 2 ? -1 : Math.min(lineOffset - 2, table.rows.length - 1)
  const colIndex = Math.min(
    columnAtOffset(line.text, pos - line.from),
    Math.max(table.header.length - 1, 0)
  )
  return { tableFrom: found.from, tableTo: found.to, table, rowIndex, colIndex }
}

/**
 * Row/column context for a right-click at `pos` on `targetEl` — from DOM
 * hit-testing when the table is rendered as a real `<table>` (see
 * tableRender.ts), or from raw pipe-text offsets when it's in the
 * source-revealed editing view. Null when the click isn't inside a table at
 * all.
 *
 * A click inside the rendered widget's own padding (not on a cell) falls back
 * to the position-based lookup too, rather than coming up empty: an indented
 * table (`indentTable`, below) grows that padding into a whole left gutter —
 * `leadingIndentEm` in tableRender.ts — that's easy to land a right-click in
 * without a Table submenu turning up at all.
 *
 * Must be called before anything dispatches: `posAtDOM` only answers for DOM
 * CodeMirror still owns, and any transaction that changes the active cell
 * rebuilds the whole table widget, orphaning `targetEl`.
 */
export function readTableCtx(
  view: EditorView,
  pos: number,
  targetEl: HTMLElement | null
): TableCtx | null {
  const wrap = targetEl?.closest('.cm-md-table-wrap')
  const cell = wrap ? (targetEl?.closest('td, th') as HTMLTableCellElement | null) : null
  if (wrap && cell) {
    const tableFrom = posAtDOMSafe(view, wrap)
    // Fall back to the mouse position when the widget's DOM can't be placed:
    // better a table resolved from coordinates than the wrong table entirely.
    const ctx = tableFrom == null ? null : tableCtxFromCell(view.state, tableFrom, cell)
    if (ctx) return ctx
    const from = findTableAt(view.state, pos)?.from
    return from == null ? null : tableCtxFromCell(view.state, from, cell)
  }
  return tableCtxFromSource(view.state, pos)
}

/** `view.posAtDOM`, but null instead of a throw for DOM the view no longer owns. */
function posAtDOMSafe(view: EditorView, dom: Element): number | null {
  if (!dom.isConnected) return null
  try {
    return view.posAtDOM(dom)
  } catch {
    return null
  }
}

function applyTableEdit(
  view: EditorView,
  ctx: TableCtx,
  newTable: ParsedTable,
  landing: { row: number; col: number }
): void {
  // Open the landing cell for editing rather than dropping a bare cursor: the
  // rendered table block is atomic (see tableRender.ts), so a caret inside it
  // would be pushed out to the table's edge on the next arrow press.
  activateCell(
    view,
    {
      tableFrom: ctx.tableFrom,
      row: Math.min(landing.row, newTable.rows.length - 1),
      col: Math.min(Math.max(landing.col, 0), newTable.header.length - 1)
    },
    { from: ctx.tableFrom, to: ctx.tableTo, insert: serializeTable(newTable) }
  )
}

/** Insert a blank data row at `atIndex` and open it for editing. */
export function insertRow(view: EditorView, ctx: TableCtx, atIndex: number): void {
  applyTableEdit(view, ctx, insertTableRow(ctx.table, atIndex), {
    row: atIndex,
    col: ctx.colIndex
  })
}

/** Delete the data row at `atIndex`, landing on the nearest remaining row (or the header). */
export function deleteRow(view: EditorView, ctx: TableCtx, atIndex: number): void {
  const newTable = removeTableRow(ctx.table, atIndex)
  const row = newTable.rows.length ? Math.min(atIndex, newTable.rows.length - 1) : -1
  applyTableEdit(view, ctx, newTable, { row, col: ctx.colIndex })
}

/** Insert a blank column at `atIndex` and open it on the clicked row. */
export function insertColumn(view: EditorView, ctx: TableCtx, atIndex: number): void {
  applyTableEdit(view, ctx, insertTableColumn(ctx.table, atIndex), {
    row: ctx.rowIndex,
    col: atIndex
  })
}

/** Delete the column at `atIndex`, keeping the caret on the clicked row. */
export function deleteColumn(view: EditorView, ctx: TableCtx, atIndex: number): void {
  applyTableEdit(view, ctx, removeTableColumn(ctx.table, atIndex), {
    row: ctx.rowIndex,
    col: Math.min(ctx.colIndex, atIndex)
  })
}

/**
 * Insert a brand-new table at the caret, splitting out of any surrounding
 * paragraph text and padding with a blank line on each side so it always
 * parses as its own isolated block rather than merging with a neighbor.
 */
export function insertTableAt(view: EditorView, rows: number, cols: number): void {
  const table = emptyTableSource(rows, cols)
  const { state } = view
  const { head } = state.selection.main
  const line = state.doc.lineAt(head)
  const before = state.sliceDoc(line.from, head)
  const after = state.sliceDoc(head, line.to)
  const prevLine = line.number > 1 ? state.doc.line(line.number - 1) : null
  const nextLine = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null

  const lead = before.trim() ? '\n\n' : prevLine && prevLine.text.trim() !== '' ? '\n' : ''
  const trail = after.trim() ? '\n\n' : nextLine && nextLine.text.trim() !== '' ? '\n' : ''

  // Open the first header cell straight away, so a fresh table is ready to
  // type into instead of needing a click.
  activateCell(
    view,
    { tableFrom: head + lead.length, row: -1, col: 0 },
    { from: head, insert: `${lead}${table}${trail}` }
  )
}

/**
 * Indent or dedent every line of the whole table by one indent unit, as a
 * single edit — how a table nests under a task's checkbox line, since the
 * table's own lines are atomic (see tableRender.ts) and a caret can never
 * rest on one to select and Tab it the ordinary way. Driven from the
 * right-click Table menu rather than a keybinding: that menu already
 * resolves `ctx` reliably from wherever the user actually clicked (a cell,
 * or the raw source view), so this needs no caret-position guesswork of
 * its own.
 */
export function indentTable(view: EditorView, ctx: TableCtx, dir: 'more' | 'less'): void {
  const found = findTableAt(view.state, ctx.tableFrom)
  if (!found) return
  const to = Math.max(found.from, found.to - 1)
  // A selection-only dispatch isn't a history step on its own (see
  // EditorView docs on annotations.addToHistory), so this doesn't add a
  // separate undo entry ahead of the indent/dedent itself.
  view.dispatch({ selection: EditorSelection.range(found.from, to) })
  ;(dir === 'more' ? indentMore : indentLess)(view)
  view.focus()
}
