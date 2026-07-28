// Pure decision logic for standard markdown hyperlinks `[text](url)`, split
// out of mdLink.ts so it can be unit-tested without a DOM or the webview RPC
// bridge (the same split hoverLogic.ts, constructLogic.ts, taskLinkLogic.ts
// and embedLogic.ts already use).

/**
 * `[text](url)`, with the leading `!` captured so images can be skipped.
 *
 * The link text tolerates one level of nested brackets (`[see [1]](url)`), and
 * the URL may be angle-bracketed (`<...>`), contain balanced parens
 * (Wikipedia-style) or carry a `"title"`.
 */
const MD_LINK_RE =
  /(!?)\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*(<[^>]*>|(?:[^\s()]|\([^()]*\))*)(?:\s+"[^"]*")?\s*\)/g

export interface MdLink {
  /** The display text between the brackets (may be empty). */
  text: string
  /** The target, with any surrounding angle brackets stripped. */
  url: string
  /** Document offsets of the whole `[text](url)`. */
  from: number
  to: number
}

/**
 * The markdown link containing document offset `pos`, or null.
 *
 * `![images](src)` are deliberately skipped: knoteConstructs.ts already renders
 * those inline, and they aren't hyperlinks to follow.
 */
export function mdLinkAt(lineText: string, lineFrom: number, pos: number): MdLink | null {
  MD_LINK_RE.lastIndex = 0
  for (let m = MD_LINK_RE.exec(lineText); m; m = MD_LINK_RE.exec(lineText)) {
    if (m[1] === '!') continue
    const from = lineFrom + m.index
    const to = from + m[0].length
    if (pos >= from && pos <= to) {
      return { text: m[2], url: m[3].replace(/^<|>$/g, ''), from, to }
    }
  }
  return null
}

/**
 * A `[text](url)` link. The text falls back to the URL when blank, so an
 * inserted link is never an invisible empty span.
 */
export function buildMdLink(text: string, url: string): string {
  const trimmed = text.trim()
  return `[${trimmed || url}](${url})`
}
