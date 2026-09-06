// Pure helpers for the live-preview editor's KNote constructs — no CodeMirror,
// DOM, or host imports, so they're unit-testable under vitest and shared by
// knoteConstructs.ts.

import type { BoardColumn } from '@shared/types'
import { TASK_LINE_RE, taskMarkerRange } from '@shared/parser/patterns'

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
 * The span the checkbox widget replaces within a checkbox line (offsets
 * relative to line start), its status char, and whether the line is a *task* —
 * a Kanban card — or a plain checkbox. Null when the line isn't a checkbox.
 *
 * On a task the span runs past the `[c]` brackets to the end of the `@task`
 * marker, so the one widget hides the marker too: the pill and the checkbox
 * style already say "this is a card", and the raw marker would just be noise.
 * Because the widget renders one checkbox glyph either way, the *rendered*
 * prefix is identical for both kinds — which is what lets `hangingIndentEm`
 * keep measuring it without a special case.
 *
 * A plain checkbox is a checked/unchecked toggle rather than a Kanban status
 * cycler, so callers key off `isTask`.
 */
export function checkboxRange(
  text: string
): { from: number; to: number; statusChar: string; isTask: boolean } | null {
  const m = TASK_LINE_RE.exec(text)
  if (!m) return null
  const from = m[1].length + m[2].length + 1 // indent + bullet + the single space
  const marker = taskMarkerRange(text)
  return { from, to: marker?.to ?? from + 3, statusChar: m[3], isTask: marker !== null }
}
