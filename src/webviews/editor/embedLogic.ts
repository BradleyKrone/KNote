// Pure decision logic for note transclusion, split out of embedRender.ts so it
// can be unit-tested without a DOM (the same split constructLogic.ts and
// taskLinkLogic.ts already use).

import { WIKI_LINK_RE } from '@shared/parser/patterns'
import { isImage } from '@shared/pathUtils'
import { splitWikiTarget } from '@shared/wikiResolve'

/**
 * The raw target of a *note* embed that owns this whole line, or null.
 *
 * Two deliberate restrictions:
 *  - **Image embeds are excluded** — knoteConstructs.ts renders those inline,
 *    and it does it well; only notes need the card treatment.
 *  - **The embed must be alone on its line** (whitespace aside). The card is a
 *    block widget replacing the entire line, so anything sharing that line
 *    would be hidden. Obsidian draws the same distinction: an embed on its own
 *    line becomes a block, one inside a sentence stays inline.
 */
export function noteEmbedLine(text: string): string | null {
  const trimmed = text.trim()
  WIKI_LINK_RE.lastIndex = 0
  const m = WIKI_LINK_RE.exec(trimmed)
  if (!m || m[0] !== trimmed || m[1] !== '!') return null
  const rawTarget = m[2] + (m[3] ?? '')
  if (isImage(splitWikiTarget(rawTarget).target)) return null
  return rawTarget
}

/**
 * True when this line is a note embed rendered as a card. Lets
 * knoteConstructs.ts skip its own inline decorations for a line embedRender has
 * replaced wholesale — the coordination `isCollapsedMermaidFence` provides for
 * fenced code.
 */
export function isNoteEmbedLine(text: string): boolean {
  return noteEmbedLine(text) !== null
}
