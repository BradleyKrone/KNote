// "Copy link to task" for the live-preview editor. Gives a task (or any line) a
// stable Obsidian-style block anchor (` ^id` appended to the line) and copies a
// `[[Note#^id|Task text]]` wiki link to the clipboard, so it can be pasted into
// a daily note and clicked to jump straight back to that task.
//
// The block-anchor + [[Note#^id]] navigation already exists end-to-end (indexed
// by parseNote, resolved by wikiResolve, opened by openWikiTarget) — this just
// mints the anchor and the link. The pure builders live in shared/blockAnchor,
// and the CodeMirror-only, host-free half in taskLinkLogic.ts.

import type { EditorView } from '@codemirror/view'
import { anchorLine, blockIdOf, blockLink, linkAlias, makeBlockId } from '@shared/blockAnchor'
import { host } from '../shared/rpc'
import { showToast } from '../shared/stores'
import { docBlockIds } from './taskLinkLogic'

/**
 * Ensure the given line carries a block anchor (appending one if missing) and
 * copy a link to it, aliased to the line's own text so the link reads as the
 * task rather than as `Note > ^id`. Dispatched straight into CodeMirror — the
 * edit syncs out to the file like any other typed change.
 */
export function copyTaskLink(view: EditorView, line0: number, noteTitle: string): void {
  const line = view.state.doc.line(line0 + 1)
  let id = blockIdOf(line.text)
  if (!id) {
    id = makeBlockId(line.text, docBlockIds(view.state))
    view.dispatch({ changes: { from: line.from, to: line.to, insert: anchorLine(line.text, id) } })
  }
  const link = blockLink(noteTitle, id, linkAlias(line.text))
  void host.copyToClipboard(link).then(() => showToast(`Copied link: ${link}`))
}
