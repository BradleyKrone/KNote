// Pure decision logic for the link hover preview, split out of linkHover.ts so
// it can be unit-tested without a DOM or the webview RPC bridge (the same split
// constructLogic.ts, taskLinkLogic.ts and embedLogic.ts already use).

import { WIKI_LINK_RE } from '@shared/parser/patterns'

export interface HoveredLink {
  /** Target as written, including any `#Heading` / `#^block` */
  rawTarget: string
  /** Document offsets of the whole `[[…]]` */
  from: number
  to: number
}

/**
 * The wiki link containing document offset `pos`, or null.
 *
 * `![[embeds]]` are deliberately skipped: an embed already displays the note's
 * content inline, so previewing it on hover would be redundant.
 */
export function wikiLinkAt(lineText: string, lineFrom: number, pos: number): HoveredLink | null {
  WIKI_LINK_RE.lastIndex = 0
  for (let m = WIKI_LINK_RE.exec(lineText); m; m = WIKI_LINK_RE.exec(lineText)) {
    if (m[1] === '!') continue
    const from = lineFrom + m.index
    const to = from + m[0].length
    if (pos >= from && pos <= to) return { rawTarget: m[2] + (m[3] ?? ''), from, to }
  }
  return null
}

/** Leading `limit` lines of `content`, flagging whether anything was cut. */
export function truncateLines(
  content: string,
  limit: number
): { text: string; truncated: boolean } {
  const lines = content.split('\n')
  return lines.length <= limit
    ? { text: content, truncated: false }
    : { text: lines.slice(0, limit).join('\n'), truncated: true }
}
