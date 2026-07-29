// Structural table edits for the right-click menu: insert a fresh table at
// the caret, or insert/delete the row or column under a click on an
// existing one. Every op rewrites the whole table block (parse -> transform
// -> serialize -> one dispatch), which keeps columns padded/aligned but also
// means stray extra cells beyond the header count (silently dropped today by
// parseTable, per the GFM spec) are dropped for good the first time a table
// with that quirk is touched here.

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
 * Row/column context for a click at `pos` inside a table — from DOM hit-testing
 * when it's rendered as a real `<table>` (see tableRender.ts), or from raw
 * pipe-text offsets when it's in the cursor-revealed editing view. Null when
 * `pos` isn't inside a table, or lands in the rendered widget's own padding
 * rather than on a cell.
 */
export function readTableCtx(
  view: EditorView,
  pos: number,
  targetEl: HTMLElement | null
): TableCtx | null {
  const wrap = targetEl?.closest('.cm-md-table-wrap')
  if (wrap) {
    const cell = targetEl?.closest('td, th')
    if (!cell) return null
    const found = findTableAt(view.state, view.posAtDOM(wrap))
    if (!found) return null
    const table = parseTable(found.raw)
    const tr = cell.closest('tr')
    const isHeader = cell.closest('thead') != null
    const colIndex = Math.min(
      (cell as HTMLTableCellElement).cellIndex,
      Math.max(table.header.length - 1, 0)
    )
    const rowIndex = isHeader ? -1 : (tr?.sectionRowIndex ?? 0)
    return { tableFrom: found.from, tableTo: found.to, table, rowIndex, colIndex }
  }

  const found = findTableAt(view.state, pos)
  if (!found) return null
  const table = parseTable(found.raw)
  const line = view.state.doc.lineAt(pos)
  const startLine = view.state.doc.lineAt(found.from).number
  const lineOffset = line.number - startLine // 0 = header, 1 = delimiter, 2+ = data row
  const rowIndex = lineOffset < 2 ? -1 : lineOffset - 2
  const colIndex = Math.min(
    columnAtOffset(line.text, pos - line.from),
    Math.max(table.header.length - 1, 0)
  )
  return { tableFrom: found.from, tableTo: found.to, table, rowIndex, colIndex }
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
