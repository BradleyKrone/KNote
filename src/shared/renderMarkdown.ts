// Markdown → HTML for the places KNote has to *display* a note rather than
// edit it: the `![[embed]]` cards and link hover previews in the live-preview
// editor, and VS Code's Reading-mode preview.
//
// markdown-it does the CommonMark/GFM half; two small rules here add the
// KNote/Obsidian syntax it doesn't know — `[[wiki links]]` (with `#section`,
// `|display text` and the `![[…]]` embed form) and `#tags`.
//
// Raw HTML in note source is deliberately *not* parsed (`html: false`): these
// strings end up inside webviews, and a note should never be able to inject
// markup into one. The rules below emit their own html_inline tokens, which
// render regardless of that option.

import MarkdownIt from 'markdown-it'
import type { StateInline } from 'markdown-it/index.js'
import { hljsHighlight } from './codeHighlight'
import { TAG_RE } from './parser/patterns'
import { isDrawioFile, isImage } from './pathUtils'
import { splitWikiTarget } from './wikiResolve'

export interface KnoteRenderOptions {
  /**
   * Href for a `[[wiki link]]`, given the raw target as written (including any
   * `#section`). Return null — or omit the callback — to render the link as
   * inert text, which is what an unresolved target should look like.
   */
  wikiHref?: (rawTarget: string) => string | null
  /** Source URI for an `![[image]]` / `![](image)` target, or null when it doesn't resolve. */
  imageSrc?: (target: string) => string | null
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch])
}

const OPEN_BRACKET = 0x5b // [
const BANG = 0x21 // !

/**
 * Inline rule for `[[target#section|display]]` and the `![[…]]` embed form.
 * Registered ahead of markdown-it's own `image`/`link` rules so `![[x]]` is
 * never mistaken for a half-formed markdown image.
 */
function wikiLinkRule(opts: KnoteRenderOptions) {
  return (state: StateInline, silent: boolean): boolean => {
    const { src, pos } = state
    const isEmbed = src.charCodeAt(pos) === BANG
    const open = isEmbed ? pos + 1 : pos
    if (src.charCodeAt(open) !== OPEN_BRACKET || src.charCodeAt(open + 1) !== OPEN_BRACKET) {
      return false
    }
    const close = src.indexOf(']]', open + 2)
    if (close === -1) return false
    const inner = src.slice(open + 2, close)
    if (inner === '' || /[[\]\n]/.test(inner)) return false

    if (!silent) {
      const pipe = inner.indexOf('|')
      const rawTarget = (pipe === -1 ? inner : inner.slice(0, pipe)).trim()
      const display = (pipe === -1 ? '' : inner.slice(pipe + 1).trim()) || rawTarget
      const { target } = splitWikiTarget(rawTarget)
      if (isEmbed && isImage(target)) pushImage(state, target, display, opts)
      else pushWikiLink(state, rawTarget, display, opts)
    }
    state.pos = close + 2
    return true
  }
}

/**
 * Emit real `link_open`/`text`/`link_close` tokens rather than raw HTML, so a
 * host that post-processes links — VS Code's Markdown preview rewrites hrefs
 * and image srcs into webview-safe URIs in its own renderer rules — sees an
 * ordinary link and handles it. An unresolved target has no href to give, so it
 * falls back to inert markup.
 */
function pushWikiLink(
  state: StateInline,
  rawTarget: string,
  display: string,
  opts: KnoteRenderOptions
): void {
  const href = opts.wikiHref?.(rawTarget) ?? null
  if (href === null) {
    const token = state.push('html_inline', '', 0)
    token.content =
      `<span class="knote-wikilink knote-unresolved" title="${escapeHtml(rawTarget)}">` +
      `${escapeHtml(display)}</span>`
    return
  }
  const open = state.push('link_open', 'a', 1)
  open.attrs = [
    ['href', href],
    ['class', 'knote-wikilink'],
    ['title', rawTarget],
    // The target verbatim, for consumers that resolve it themselves rather than
    // following the href — the embed card hands this straight to
    // openWikiTarget. Kept separate from href because the href belongs to
    // whoever renders the HTML: VS Code's Markdown preview rewrites hrefs in
    // its own renderer rules, and the embed card sets an inert placeholder.
    ['data-knote-target', rawTarget]
  ]
  state.push('text', '', 0).content = display
  state.push('link_close', 'a', -1)
}

/** Emit a normal `image` token for an `![[picture.png]]` embed, for the same reason. */
function pushImage(
  state: StateInline,
  target: string,
  display: string,
  opts: KnoteRenderOptions
): void {
  const src = opts.imageSrc?.(target) ?? null
  if (src === null) {
    const token = state.push('html_inline', '', 0)
    token.content = `<span class="knote-embed-missing">${escapeHtml(display)}</span>`
    return
  }
  const token = state.push('image', 'img', 0)
  token.attrs = [
    ['src', src],
    ['alt', ''],
    // draw.io's SVG exports have a transparent canvas and default black
    // lines/arrows — invisible on a dark theme without a light backing
    // behind them (markdownPreview.css / editor.css supply it).
    [
      'class',
      isDrawioFile(target) ? 'knote-embed-image knote-embed-image-drawio' : 'knote-embed-image'
    ]
  ]
  // markdown-it's image renderer derives the alt text from the token's children.
  const alt = new state.Token('text', '', 0)
  alt.content = display
  token.children = [alt]
  token.content = display
}

/**
 * A *note* embed renders as a link rather than expanding, so transclusion never
 * recurses — the editor's embed widget owns the one level of expansion it does
 * perform (see webviews/editor/embedRender.ts).
 */

/**
 * Core rule turning `#tag` runs inside already-parsed text into pills. Done as
 * a post-parse token walk rather than an inline rule so it can't touch
 * `code_inline` or fenced-code tokens, which are separate token types by then.
 */
function tagRule(state: { tokens: Array<{ type: string; children?: unknown }> }): void {
  for (const block of state.tokens) {
    if (block.type !== 'inline') continue
    const children = block.children as Array<{ type: string; content: string; level?: number }>
    if (!children) continue
    const out: Array<{ type: string; content: string; level?: number }> = []
    for (const token of children) {
      if (token.type !== 'text') {
        out.push(token)
        continue
      }
      out.push(...splitTags(token))
    }
    block.children = out
  }
}

/** One text token → alternating text / tag-pill tokens. */
function splitTags(token: { type: string; content: string; level?: number }): Array<{
  type: string
  content: string
  level?: number
}> {
  const parts: Array<{ type: string; content: string; level?: number }> = []
  let last = 0
  TAG_RE.lastIndex = 0
  for (let m = TAG_RE.exec(token.content); m; m = TAG_RE.exec(token.content)) {
    const name = m[2]
    if (/^\d+$/.test(name)) continue // numeric-only isn't a tag (Obsidian rule)
    const hashAt = m.index + m[1].length
    if (hashAt > last) {
      parts.push({ type: 'text', content: token.content.slice(last, hashAt), level: token.level })
    }
    parts.push({
      type: 'html_inline',
      content: `<span class="knote-tag">#${escapeHtml(name)}</span>`,
      level: token.level
    })
    last = hashAt + 1 + name.length
  }
  if (parts.length === 0) return [token]
  if (last < token.content.length) {
    parts.push({ type: 'text', content: token.content.slice(last), level: token.level })
  }
  return parts
}

/**
 * Add KNote's `[[wiki link]]`, `![[embed]]` and `#tag` rules to an existing
 * markdown-it instance. Used both on KNote's own renderer and on the instance
 * VS Code hands to `extendMarkdownIt` for its Markdown preview, which is why
 * this takes an instance rather than making one.
 */
export function applyKnoteRules(md: MarkdownIt, opts: KnoteRenderOptions = {}): MarkdownIt {
  md.inline.ruler.before('image', 'knote_wikilink', wikiLinkRule(opts))
  md.core.ruler.push('knote_tag', tagRule as Parameters<typeof md.core.ruler.push>[1])
  return md
}

/** A fresh markdown-it instance carrying KNote's rules. */
export function createRenderer(opts: KnoteRenderOptions = {}): MarkdownIt {
  return applyKnoteRules(
    new MarkdownIt({ html: false, linkify: true, breaks: false, highlight: hljsHighlight }),
    opts
  )
}

/** One-shot render. Prefer holding a `createRenderer` instance when rendering repeatedly. */
export function renderKnoteMarkdown(source: string, opts: KnoteRenderOptions = {}): string {
  return createRenderer(opts).render(source)
}
