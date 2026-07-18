// Pure decision logic for auto-seeding a task's attached note on Enter.
// No CodeMirror view, DOM, or host imports, so it's unit-testable under vitest
// and free of side effects; the keymap wrapper lives in taskEnter.ts.

import type { EditorState } from '@codemirror/state'
import {
  DATE_ENTERED_RE,
  mergeTaskMetaLines,
  STATUS_CHANGED_UNSET,
  TASK_LINE_RE
} from '@shared/parser/patterns'
import { blockIdOf } from './taskLinkLogic'

export interface TaskNoteSeed {
  /** Document offset to insert at (end of the task line or its last meta line). */
  at: number
  /** Text to insert (leading newline + template lines). */
  insert: string
  /**
   * The task line's end offset, where a `^block-id` anchor should be appended
   * so the freshly-created task is immediately linkable — or null when the line
   * already carries one. The random id itself is minted by the keymap binding
   * (taskEnter.ts) to keep this planner deterministic.
   */
  anchorAt: number | null
}

/**
 * Decide whether Enter on the current selection should seed a task note, and
 * if so where and what to insert. Returns null — meaning "let the default
 * newline run" — for a nested task, an empty checkbox, a plain bullet (no
 * `[ ]`), a caret that isn't at the end of the line's content, a multi-cursor
 * selection, or a task that already carries a `Date Entered` line.
 *
 * `today` (an `M/D/YYYY` date) and `nl` (the document's line break) are
 * injected so the function stays deterministic and headless for tests.
 */
export function planTaskNoteSeed(
  state: EditorState,
  today: string,
  nl = '\n'
): TaskNoteSeed | null {
  const range = state.selection.main
  if (state.selection.ranges.length !== 1 || !range.empty) return null

  const doc = state.doc
  const line = doc.lineAt(range.head)
  // Only when the caret sits at the end of the line's content. Trailing
  // whitespace (e.g. a stray space, or a `\r` if the line separator ever
  // drifts from the doc's real EOL) shouldn't block seeding.
  if (line.text.slice(range.head - line.from).trim() !== '') return null

  const task = TASK_LINE_RE.exec(line.text)
  if (!task || task[1].length > 0) return null // top-level tasks only
  if ((task[4]?.trim() ?? '') === '') return null // don't seed an empty checkbox

  // Step over any Reason/Status lines already directly under the task, the
  // same way the insertTaskNote command anchors below them.
  const peek: string[] = []
  for (let i = 1; i <= 2 && line.number + i <= doc.lines; i++) {
    peek.push(doc.line(line.number + i).text)
  }
  const metaLen = mergeTaskMetaLines(peek, {}).consumed

  // Already seeded (a Date Entered line follows the meta)? Leave Enter alone.
  const seededNum = line.number + metaLen + 1
  if (seededNum <= doc.lines && DATE_ENTERED_RE.test(doc.line(seededNum).text)) return null

  const childIndent = task[1] + '  '
  const statusSeed =
    metaLen === 0 ? `${childIndent}- Status Changed: ${STATUS_CHANGED_UNSET}${nl}` : ''
  const insert = `${nl}${statusSeed}${childIndent}- Date Entered: ${today}${nl}${childIndent}- Notes: `
  const at = doc.line(line.number + metaLen).to
  const anchorAt = blockIdOf(line.text) === null ? line.to : null
  return { at, insert, anchorAt }
}
