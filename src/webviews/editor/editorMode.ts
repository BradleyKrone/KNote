// What a CodeMirror view is showing. The same editor stack serves two very
// different things, and a handful of behaviours have to know which.

import { Facet, type EditorState } from '@codemirror/state'

export type EditorKind =
  /**
   * A whole note, two-way synced with a VS Code TextDocument. Line numbers are
   * absolute positions in that note, so host RPCs may address them, and a
   * checkbox at column 0 is a genuine top-level task — a Kanban card.
   */
  | 'note'
  /**
   * A detached, dedented block that the caller owns and saves itself: the
   * board's task editor, holding one task's attached block. Two consequences:
   *
   * - Line numbers mean nothing to the host — line 0 here is some arbitrary
   *   line of some note — so every task write has to be a local transaction
   *   and the whole fragment goes back in one verified edit on Save.
   * - The fragment is the *interior* of a task, so a checkbox at column 0 is
   *   still a sub-task. Nothing in here is ever top-level.
   */
  | 'fragment'

export const editorKind = Facet.define<EditorKind, EditorKind>({
  combine: (values) => values[0] ?? 'note'
})

/**
 * Does a task line with this indent count as top-level — a Kanban card, with a
 * column pill, a status menu, a group card and Enter-to-seed? Only in a whole
 * note: everything in a fragment is nested inside the task the fragment belongs
 * to, however flush-left it looks.
 */
export function isTopLevelTask(state: EditorState, indent: string): boolean {
  return indent.length === 0 && state.facet(editorKind) === 'note'
}
