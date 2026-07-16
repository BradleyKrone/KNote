// Pure helpers for the live-preview editor's KNote constructs — no CodeMirror,
// DOM, or host imports, so they're unit-testable under vitest and shared by
// knoteConstructs.ts.

import type { BoardColumn } from '@shared/types'
import { TASK_LINE_RE } from '@shared/parser/patterns'

/** Which column a status char maps to; unknown chars land in column 0 (mirrors boardSelectors). */
export function columnForChar(columns: BoardColumn[], char: string): number {
  const norm = char === 'X' ? 'x' : char
  const idx = columns.findIndex((c) => c.char === norm)
  return idx === -1 ? 0 : idx
}

/** The column a checkbox advances to when clicked (wraps around), or null if none configured. */
export function nextColumn(columns: BoardColumn[], char: string): BoardColumn | null {
  if (columns.length === 0) return null
  return columns[(columnForChar(columns, char) + 1) % columns.length]
}

/**
 * The `[c]` bracket span within a task line (offsets relative to line start)
 * and its status char, or null when the line isn't a task. Used to place the
 * clickable checkbox widget.
 */
export function checkboxRange(
  text: string
): { from: number; to: number; statusChar: string } | null {
  const m = TASK_LINE_RE.exec(text)
  if (!m) return null
  const from = m[1].length + m[2].length + 1 // indent + bullet + the single space
  return { from, to: from + 3, statusChar: m[3] }
}
