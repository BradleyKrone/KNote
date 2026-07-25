// Hover a `[[wiki link]]` to preview the note behind it, the way Obsidian
// does. The extension host's providers/hover.ts can't serve this — a
// vscode.HoverProvider only fires in a text editor, never inside the live
// preview's webview — so the tooltip is a CodeMirror hoverTooltip here.
//
// Reuses the embed machinery wholesale: the same `readEmbed` RPC (so
// `[[Note#Heading]]` previews just that section) and the same markdown
// renderer as the transclusion cards.

import { hoverTooltip, type EditorView, type Tooltip } from '@codemirror/view'
import { parentOf, resolveEmbedPath } from '@shared/pathUtils'
import { createRenderer } from '@shared/renderMarkdown'
import { host } from '../shared/rpc'
import { truncateLines, wikiLinkAt } from './hoverLogic'

/** How much of the note to show before trailing off. */
const PREVIEW_LINES = 15

function buildTooltipDom(target: string): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'cm-knote-hover cm-knote-hover-loading'

  const title = document.createElement('div')
  title.className = 'cm-knote-hover-title'
  wrap.appendChild(title)

  void host.readEmbed(target).then((embed) => {
    wrap.classList.remove('cm-knote-hover-loading')
    if (!embed) {
      wrap.classList.add('cm-knote-hover-missing')
      title.textContent = target
      const msg = document.createElement('div')
      msg.className = 'cm-knote-hover-body'
      msg.textContent = 'Note not found — click the link to create it.'
      wrap.appendChild(msg)
      return
    }

    title.textContent = embed.title
    const { text, truncated } = truncateLines(embed.content, PREVIEW_LINES)
    const folder = parentOf(embed.path)
    const md = createRenderer({
      // A preview is read-only: nothing in it should look or act clickable,
      // since a click closes the tooltip before it could ever land.
      wikiHref: () => null,
      imageSrc: (src) => {
        const rel = resolveEmbedPath(folder, src)
        return rel === null ? null : 'knote-hover-img:' + rel
      }
    })

    const body = document.createElement('div')
    body.className = 'cm-knote-hover-body'
    body.innerHTML = md.render(text)
    for (const img of Array.from(body.querySelectorAll('img'))) {
      const src = img.getAttribute('src') ?? ''
      if (!src.startsWith('knote-hover-img:')) continue
      img.removeAttribute('src')
      void host.attachmentUri('/' + src.slice('knote-hover-img:'.length)).then((uri) => {
        if (uri) img.src = uri
      })
    }
    wrap.appendChild(body)

    if (truncated) {
      const more = document.createElement('div')
      more.className = 'cm-knote-hover-more'
      more.textContent = '…'
      wrap.appendChild(more)
    }
  })

  return wrap
}

/** Hover a `[[link]]` for a rendered preview of its note. */
export const linkHover = hoverTooltip(
  (view: EditorView, pos: number): Tooltip | null => {
    const line = view.state.doc.lineAt(pos)
    // Works even where a WikiLinkWidget has replaced the text: the widget
    // occupies its source range, so `pos` still lands inside the raw `[[…]]`.
    const link = wikiLinkAt(line.text, line.from, pos)
    if (!link) return null
    return {
      pos: link.from,
      end: link.to,
      above: true,
      create: () => ({ dom: buildTooltipDom(link.rawTarget) })
    }
  },
  { hoverTime: 400 }
)
