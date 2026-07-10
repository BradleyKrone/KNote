import type { Text } from '@codemirror/state'
import type { HeadingRef } from '@shared/types'

const ATX_HEADING_RE = /^ {0,3}(#{1,6})\s/
const FENCE_RE = /^ {0,3}(```|~~~)/

/**
 * Lightweight, live-typing-friendly heading scan of the editor's document.
 * Cheaper than the full remark-based parseNote() parse, at the cost of
 * missing setext headings (`Title\n===`) and headings inside blockquotes
 * (`> # Foo`), which the outline panel doesn't need to handle perfectly.
 */
export function scanHeadings(doc: Text): HeadingRef[] {
  const headings: HeadingRef[] = []
  let inFence = false

  for (let i = 1; i <= doc.lines; i++) {
    const text = doc.line(i).text
    if (FENCE_RE.test(text)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const match = ATX_HEADING_RE.exec(text)
    if (!match) continue
    const level = match[1].length
    const heading = text
      .slice(match[0].length)
      .replace(/\s+#+\s*$/, '')
      .trim()
    headings.push({ text: heading, level, line: i - 1 })
  }

  return headings
}
