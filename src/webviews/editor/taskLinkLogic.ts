// The CodeMirror-bound half of "Copy link to task" — no DOM or host imports,
// so importing it never pulls in the webview RPC bridge (which calls
// acquireVsCodeApi at module load and so can't be reached from vitest).
// The rest of the block-anchor logic is host-free and lives in
// @shared/blockAnchor; the side-effecting wrapper lives in taskLink.ts.

import type { EditorState } from '@codemirror/state'
import { blockIdOf } from '@shared/blockAnchor'

/**
 * Every `^block-id` already used in the document — what a freshly minted id has
 * to avoid, now that ids are slugs derived from task text and two identically
 * worded tasks would otherwise collide. Used by both anchor-minting paths:
 * "Copy link to task" (taskLink.ts) and the auto-anchor on Enter (taskEnter.ts).
 */
export function docBlockIds(state: EditorState): string[] {
  const ids: string[] = []
  for (const line of state.doc.iterLines()) {
    const id = blockIdOf(line)
    if (id) ids.push(id)
  }
  return ids
}
