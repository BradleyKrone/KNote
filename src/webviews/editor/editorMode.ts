// What a CodeMirror view is showing. The same editor stack serves two very
// different things, and a handful of behaviours have to know which.

import { Facet, type EditorState } from '@codemirror/state'
import { isTaskLine } from '@shared/parser/patterns'

export type EditorKind =
  /**
   * A whole note, two-way synced with a VS Code TextDocument. Line numbers are
   * absolute positions in that note, so host RPCs may address them and a
   * minted `^block-id` can be checked for uniqueness against the whole note.
   */
  | 'note'
  /**
   * A detached, dedented block that the caller owns and saves itself: the
   * board's task editor, holding one task's attached block.
   *
   * Line numbers mean nothing to the host — line 0 here is some arbitrary line
   * of some note — so every task write has to be a local transaction and the
   * whole fragment goes back in one verified edit on Save.
   */
  | 'fragment'

export const editorKind = Facet.define<EditorKind, EditorKind>({
  combine: (values) => values[0] ?? 'note'
})

/**
 * Is this line a Kanban card — column pill, status menu, group card,
 * Enter-to-seed?
 *
 * Task-ness itself is purely textual (`isTaskLine`: does the checkbox carry
 * `@task`), so the view kind no longer has any say in it. What the facet still
 * gates is whether those *actions* may address the host: a fragment's line
 * numbers are meaningless outside itself, and a `^block-id` minted in one
 * can't be checked against the note it came from.
 *
 * A fragment holds one task's block, and a nested `@task` ends that block
 * rather than joining it — so a card in here is only ever one the user just
 * typed, or one carried in verbatim inside a fenced code sample.
 */
export function isBoardTask(state: EditorState, lineText: string): boolean {
  return isTaskLine(lineText) && state.facet(editorKind) === 'note'
}
