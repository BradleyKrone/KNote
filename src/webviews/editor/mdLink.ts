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
import { mdLinkAt, type MdLink } from './mdLinkLogic'
import { rangeRevealed } from './reveal'

/**
 * The hyperlink under a mouse event, or null when the click shouldn't follow
 * one — no link there, an unsafe scheme, or the link's own raw markdown is
 * revealed (the caret is in it, so clicks belong to editing).
 */
function followableLinkAt(view: EditorView, event: MouseEvent): MdLink | null {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (pos === null) return null
  const line = view.state.doc.lineAt(pos)

  const link = mdLinkAt(line.text, line.from, pos)
  // mdLinkAt is deliberately inclusive of both ends (the context menu wants
  // that reach); a click has to land strictly inside, so the blank space past
  // a line-ending link still just places the caret.
  if (!link || pos <= link.from || pos >= link.to) return null
  // Only the link being edited (caret inside it, raw `(url)` showing) is left
  // alone — a caret elsewhere on the line doesn't unrender or disable it.
  if (rangeRevealed(view.state, link.from, link.to)) return null
  return isExternalUrl(link.url) || link.url.startsWith('file:') ? link : null
}

/**
 * True when the click actually lands on the link's rendered text. The hidden
 * `](url)` sits at the end of the link, so blank space past it maps to a
 * position *inside* the link and can't be told apart by position alone —
 * instead the visible text's DOM boxes are hit-tested. If they can't be
 * measured, it counts as a hit, so a link never stops being clickable.
 */
function onLinkText(view: EditorView, link: MdLink, event: MouseEvent): boolean {
  const textFrom = link.from + 1
  const textTo = textFrom + link.text.length
  if (textTo <= textFrom) return true
  try {
    const start = view.domAtPos(textFrom, 1)
    const end = view.domAtPos(textTo, -1)
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0)
    if (rects.length === 0) return true
    const { clientX: x, clientY: y } = event
    return rects.some(
      (r) => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1
    )
  } catch {
    return true
  }
}

/** Hand a followed link to the host: `file:` opens in the default app, the rest in the browser. */
export function openLink(url: string): void {
  void (url.startsWith('file:') ? host.openFile(url) : host.openExternal(url))
}

export const mdLink = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false
    const link = followableLinkAt(view, event)
    if (!link) return false
    if (!onLinkText(view, link, event)) {
      // Beside the link, not on it: put the caret after the link (not inside,
      // which would reveal its raw markdown) so text can be added there.
      event.preventDefault()
      // Tagged as a pointer selection so the link stays rendered (reveal.ts).
      view.dispatch({ selection: { anchor: link.to }, userEvent: 'select.pointer' })
      view.focus()
      return true
    }
    // Stop CodeMirror placing the caret first — that would reveal the raw
    // markdown and shift the text out from under the click.
    event.preventDefault()
    openLink(link.url)
    return true
  }
})
