// Click a `[text](url)` hyperlink to open it in the OS default browser, the way
// Obsidian does. The `(url)` half is hidden by livePreview.ts, so the link
// reads as plain text and this handler is what makes it actually go somewhere.
//
// A wiki link gets this for free — it's a widget with ignoreEvent() returning
// true (knoteConstructs.ts) — but a hyperlink's text stays real editable
// document text, so the click is intercepted here instead.
//
// Nothing is fetched: the URL is handed to the host, which hands it to the OS
// (see shared/externalUrl.ts). KNote itself stays fully offline.

import { EditorView } from '@codemirror/view'
import { isExternalUrl } from '@shared/externalUrl'
import { host } from '../shared/rpc'
import { isLineRevealed } from './livePreview'
import { mdLinkAt, type MdLink } from './mdLinkLogic'

/**
 * The hyperlink under a mouse event, or null when the click shouldn't follow
 * one — no link there, an unsafe scheme, or the line's raw markdown is
 * revealed (the caret is on it, so clicks belong to editing).
 */
function followableLinkAt(view: EditorView, event: MouseEvent): MdLink | null {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (pos === null) return null
  const line = view.state.doc.lineAt(pos)
  if (isLineRevealed(view.state, line.number)) return null

  const link = mdLinkAt(line.text, line.from, pos)
  // mdLinkAt is deliberately inclusive of both ends (the context menu wants
  // that reach); a click has to land strictly inside, so the blank space past
  // a line-ending link still just places the caret.
  if (!link || pos <= link.from || pos >= link.to) return null
  return isExternalUrl(link.url) ? link : null
}

export const mdLink = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false
    const link = followableLinkAt(view, event)
    if (!link) return false
    // Stop CodeMirror placing the caret first — that would reveal the raw
    // markdown and shift the text out from under the click.
    event.preventDefault()
    void host.openExternal(link.url)
    return true
  }
})
