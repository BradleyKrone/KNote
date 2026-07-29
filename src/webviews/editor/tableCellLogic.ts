// Position math for editing one table cell in place — where a cell's text
// lives in the document, what replacing it looks like, and which cell a
// navigation key lands on. Pure `EditorState` in, plan out: no view, no DOM, so
// it's all reachable from vitest (see tests/tableCellLogic.test.ts). The CM
// binding that consumes these plans lives in tableCellEdit.ts.
//
// CRLF safety lives here. Every offset is derived from the CodeMirror `Text`
// (`doc.line(n).from + offset`), never from arithmetic over a sliced string,
// and a cell commit is always a single-line replacement — `insert` must never
// contain a line break. See the CmPos doc comment in @shared/editorSync for why
// an offset that crosses a line boundary corrupts a CRLF note.

import type { EditorState } from '@codemirror/state'
import { cellOffsets, escapeCell, sanitizeCellText, splitRow } from './tableModel'

/** Just enough of an ActiveCell to locate a cell within one table's raw text. */
interface CellCoords {
  row: number
  col: number
}

/** The cell currently being typed into. `row` is -1 for the header row. */
export interface ActiveCell {
  /** Document offset of the table's first line. */
  tableFrom: number
  row: number
  col: number
  /** Monotonic session id — see tableCellEdit.ts. */
  id: number
}

/** A single-line document replacement. */
export interface CellPlan {
  from: number
  to: number
  insert: string
}

/** Where a navigation key lands. */
export type CellMove =
  | { kind: 'cell'; row: number; col: number }
  /** Past the last row: append a blank one and land on it at `col`. */
  | { kind: 'append'; col: number }
  /** Past the table's edge: leave it, putting the caret before or after. */
  | { kind: 'exit'; where: 'before' | 'after' }

export type CellDir = 'next' | 'prev' | 'up' | 'down'

/** Number of columns and data rows a table has. */
export interface TableShape {
  cols: number
  rows: number
}

/**
 * A table's raw text with the cell being edited collapsed away, so two versions
 * of it that differ only inside that cell compare equal.
 *
 * This is what keeps in-place editing viable. TableWidget.eq() compares masked
 * text, so a keystroke in the active cell leaves the widget comparing equal and
 * CodeMirror reuses the exact DOM node — and with it the nested cell editor's
 * focus and caret — instead of rebuilding the table under the user's hands.
 */
export function maskActiveCell(raw: string, active: CellCoords | null): string {
  if (!active) return raw
  const lines = raw.split('\n')
  const idx = active.row < 0 ? 0 : active.row + 2
  if (idx < 0 || idx >= lines.length) return raw
  const cells = cellOffsets(lines[idx])
  if (active.col < 0 || active.col >= cells.length) return raw
  const { from, to } = cells[active.col]
  lines[idx] = `${lines[idx].slice(0, from)} ${lines[idx].slice(to)}`
  return lines.join('\n')
}

/**
 * The document line holding model row `row` of the table starting at
 * `tableFrom` — the header line for -1, then row 0 two lines further down
 * (header, delimiter, first data row). Null when that line doesn't exist or
 * has stopped looking like a table row.
 */
function rowLine(
  state: EditorState,
  tableFrom: number,
  row: number
): { from: number; text: string } | null {
  const { doc } = state
  if (tableFrom < 0 || tableFrom > doc.length) return null
  const start = doc.lineAt(tableFrom)
  if (start.from !== tableFrom) return null
  const n = start.number + (row < 0 ? 0 : row + 2)
  if (n < 1 || n > doc.lines) return null
  const line = doc.line(n)
  if (!line.text.includes('|')) return null
  return { from: line.from, text: line.text }
}

/**
 * Document offsets of one cell's span — the text between its pipes, padding
 * included. Null when the coordinates don't resolve, which happens for a
 * ragged row that carries fewer cells than the header; the caller falls back
 * to rewriting the whole table in that case.
 */
export function cellRange(
  state: EditorState,
  tableFrom: number,
  row: number,
  col: number
): { from: number; to: number } | null {
  const line = rowLine(state, tableFrom, row)
  if (!line) return null
  const cells = cellOffsets(line.text)
  if (col < 0 || col >= cells.length) return null
  return { from: line.from + cells[col].from, to: line.from + cells[col].to }
}

/**
 * A cell's display text: the raw span, trimmed and with `\|` unescaped —
 * exactly what the rendered table shows, and what seeds the cell editor.
 */
export function cellText(
  state: EditorState,
  tableFrom: number,
  row: number,
  col: number
): string | null {
  const range = cellRange(state, tableFrom, row, col)
  if (!range) return null
  // The slice has no pipes of its own, so splitRow yields one trimmed,
  // unescaped cell — the same unescaping the rendered table went through.
  return splitRow(state.sliceDoc(range.from, range.to))[0] ?? ''
}

/**
 * Replace `active`'s cell with `text`, as one single-line change. Null when the
 * cell doesn't resolve or the document already says exactly this — returning
 * null for a no-op keeps commit-on-every-keystroke from emitting empty
 * transactions.
 */
export function commitPlan(state: EditorState, active: ActiveCell, text: string): CellPlan | null {
  const range = cellRange(state, active.tableFrom, active.row, active.col)
  if (!range) return null
  const insert = ` ${escapeCell(sanitizeCellText(text))} `
  if (state.sliceDoc(range.from, range.to) === insert) return null
  return { from: range.from, to: range.to, insert }
}

/**
 * Which cell a navigation key moves to. `appendOnOverflow` distinguishes Tab
 * and Enter (which grow the table off the bottom) from the arrow keys (which
 * leave it).
 */
export function nextCell(
  shape: TableShape,
  row: number,
  col: number,
  dir: CellDir,
  appendOnOverflow = false
): CellMove {
  const last = shape.rows - 1
  switch (dir) {
    case 'next': {
      if (col + 1 < shape.cols) return { kind: 'cell', row, col: col + 1 }
      if (row + 1 <= last) return { kind: 'cell', row: row + 1, col: 0 }
      return appendOnOverflow ? { kind: 'append', col: 0 } : { kind: 'exit', where: 'after' }
    }
    case 'prev': {
      if (col - 1 >= 0) return { kind: 'cell', row, col: col - 1 }
      if (row - 1 >= -1) return { kind: 'cell', row: row - 1, col: shape.cols - 1 }
      return { kind: 'exit', where: 'before' }
    }
    case 'down': {
      if (row + 1 <= last) return { kind: 'cell', row: row + 1, col }
      return appendOnOverflow ? { kind: 'append', col } : { kind: 'exit', where: 'after' }
    }
    case 'up': {
      if (row - 1 >= -1) return { kind: 'cell', row: row - 1, col }
      return { kind: 'exit', where: 'before' }
    }
  }
}
