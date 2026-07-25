// Note transclusion — `![[Note]]`, `![[Note#Heading]]`, `![[Note#^block]]` —
// rendered as an inline card showing the embedded note's content, the way
// Obsidian does. Image embeds are *not* handled here: knoteConstructs.ts keeps
// rendering those inline, and this field skips any target that looks like an
// image file.
//
// A note embed has to be a block widget (its content is multi-line), and block
// widgets can't be supplied by a ViewPlugin — the view needs them before it
// lays out content — so this lives in a StateField, exactly like
// mermaidRender.ts and tableRender.ts. When the cursor is on the embed's line
// the raw `![[...]]` source is left in place so it stays directly editable.

import { type EditorState, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { parentOf, resolveEmbedPath } from '@shared/pathUtils'
import { createRenderer } from '@shared/renderMarkdown'
import { host } from '../shared/rpc'
import { noteEmbedLine } from './embedLogic'

/** Doc line numbers (1-based) that intersect the selection. */
function revealedLines(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number
    const last = state.doc.lineAt(r.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

// Resolving an image to a webview URI is an RPC round trip while the renderer is
// synchronous, so image srcs are emitted as markers and rewired right after
// rendering. Links get an inert placeholder href for the same reason — they
// navigate through the host, not by the webview following a URL.
const IMG_MARKER = 'knote-embed-img:'
const LINK_HREF = '#knote-embed-link'

/** The wiki target of the link containing `node`, or null when it isn't in one. */
function wikiTargetOf(node: EventTarget | null): string | null {
  const anchor = (node as HTMLElement | null)?.closest?.('a.knote-wikilink')
  return anchor?.getAttribute('data-knote-target') ?? null
}

/**
 * Render the embedded note's markdown into the card. Images resolve relative to
 * the *embedded* note's folder — that's where they were written — hence the
 * leading `/` (vault-root-relative) handed to attachmentUri.
 */
function renderCard(wrap: HTMLElement, content: string, notePath: string): void {
  const folder = parentOf(notePath)
  const md = createRenderer({
    wikiHref: () => LINK_HREF,
    imageSrc: (target) => {
      const rel = resolveEmbedPath(folder, target)
      return rel === null ? null : IMG_MARKER + rel
    }
  })
  const body = document.createElement('div')
  body.className = 'cm-knote-embed-body'
  body.innerHTML = md.render(content)

  for (const img of Array.from(body.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (!src.startsWith(IMG_MARKER)) continue
    img.removeAttribute('src')
    void host.attachmentUri('/' + src.slice(IMG_MARKER.length)).then((uri) => {
      if (uri) img.src = uri
      else img.classList.add('cm-knote-image-missing')
    })
  }

  // One delegated listener for every wiki link in the card, so nested links
  // open their note instead of dropping the caret into the embed source. The
  // target comes from data-knote-target, not the href — the href has been
  // URL-normalized by then and openWikiTarget needs it verbatim.
  body.addEventListener('click', (e) => {
    const target = wikiTargetOf(e.target)
    if (target === null) return
    e.preventDefault()
    e.stopPropagation()
    void host.openWikiTarget(target)
  })
  // Mousedown has to be stopped too: the card's own mousedown handler would
  // otherwise replace this DOM with the raw source before the click landed.
  body.addEventListener('mousedown', (e) => {
    if (wikiTargetOf(e.target) !== null) e.stopPropagation()
  })

  wrap.appendChild(body)
}

/**
 * Bumped whenever a note in the vault changes, so cards showing that note
 * re-fetch. It rides in the widget's identity because that's the only thing
 * CodeMirror compares: without it, `eq()` would report the card unchanged and
 * the stale DOM would be kept forever.
 */
let generation = 0

/** Effect that invalidates every embed card, re-fetching their content. */
const refreshEmbeds = StateEffect.define<null>()

/**
 * Re-fetch every embed card in `view`. Called when the index reports any note
 * changed — the embedded note's content lives in another file, so nothing in
 * this document's own transactions would otherwise signal that it moved.
 */
export function refreshEmbedCards(view: EditorView): void {
  generation++
  view.dispatch({ effects: refreshEmbeds.of(null) })
}

/** True when the user has an actual text selection inside `wrap`. */
function hasSelectionInside(wrap: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false
  return wrap.contains(sel.getRangeAt(0).commonAncestorContainer)
}

class EmbedWidget extends WidgetType {
  constructor(
    private readonly rawTarget: string,
    private readonly generation: number
  ) {
    super()
  }
  eq(other: EmbedWidget): boolean {
    return other.rawTarget === this.rawTarget && other.generation === this.generation
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-knote-embed cm-knote-embed-loading'

    const header = document.createElement('div')
    header.className = 'cm-knote-embed-title'
    wrap.appendChild(header)

    // Where a click on the card navigates to, once the embed has resolved.
    // Null until then (and for an embed that can't be resolved at all), in which
    // case a click falls back to revealing the raw source so it can be fixed.
    let open: (() => void) | null = null

    /** Put the cursor on the embed's line, replacing the card with its source. */
    const revealSource = (): void => {
      const pos = view.posAtDOM(wrap)
      view.dispatch({ selection: { anchor: pos } })
      view.focus()
    }

    void host.readEmbed(this.rawTarget).then((embed) => {
      wrap.classList.remove('cm-knote-embed-loading')
      if (!embed) {
        wrap.classList.add('cm-knote-embed-missing')
        header.textContent = this.rawTarget
        const msg = document.createElement('div')
        msg.className = 'cm-knote-embed-body'
        msg.textContent = "Can't resolve this embed."
        wrap.appendChild(msg)
        return
      }
      header.textContent = embed.title
      wrap.title =
        embed.line === undefined ? `Open ${embed.path}` : `Open ${embed.path} at this section`
      wrap.classList.add('cm-knote-embed-open')
      // Opens at the embedded section for `#Heading` / `#^block` targets, and at
      // the top of the note for a whole-note embed.
      open = () => void host.openNote(embed.path, embed.line)
      renderCard(wrap, embed.content, embed.path)
    })

    // Clicking the card opens the embedded note, the same way clicking a
    // `[[link]]` chip does — an embed is a link that happens to show its target's
    // contents, and treating it as one is what Obsidian does too. Alt+click is
    // the escape hatch: it drops the cursor onto the embed's line and reveals the
    // raw `![[...]]` source for editing (arrowing onto the line still works too).
    // Wiki links inside the card stop the event before it reaches here, so they
    // still open their own target.
    wrap.addEventListener('mousedown', (e) => {
      // Keep the click from placing the caret / starting a drag-selection, which
      // would swap this DOM for the raw source before the click ever landed.
      e.preventDefault()
    })
    wrap.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.altKey || open === null) {
        revealSource()
        return
      }
      if (hasSelectionInside(wrap)) return
      open()
    })
    return wrap
  }
  // Let the widget own its mouse handling — without this the editor would also
  // treat a click inside the card as a caret placement on the embed's line.
  ignoreEvent(): boolean {
    return true
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const revealed = revealedLines(state)

  for (let n = 1; n <= state.doc.lines; n++) {
    if (revealed.has(n)) continue
    const line = state.doc.line(n)
    const rawTarget = noteEmbedLine(line.text)
    if (rawTarget === null) continue
    decorations.push(
      Decoration.replace({ widget: new EmbedWidget(rawTarget, generation), block: true }).range(
        line.from,
        line.to
      )
    )
  }
  return Decoration.set(decorations, true)
}

export const embedRender = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update(value, tr) {
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(refreshEmbeds))) {
      return buildDecorations(tr.state)
    }
    return value.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f)
})
