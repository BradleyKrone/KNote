// Which part of a note an `![[embed]]` shows.
//
// Pure text slicing, shared by the host's readEmbed handler and unit-tested
// directly. The three Obsidian embed forms:
//
//   ![[Note]]            → the whole note, frontmatter stripped
//   ![[Note#Heading]]    → that heading's section, down to the next
//                          same-or-higher heading (the same rule
//                          @codemirror/lang-markdown folds a heading by)
//   ![[Note#^block-id]]  → the anchored line plus the indented block under it,
//                          so embedding a task brings its detail along

import type { NoteMeta } from './types'
import { ownNoteBlockEnd, TASK_LINE_RE } from './parser/patterns'

/** Leading YAML frontmatter block, if the content opens with one. */
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/

export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_RE, '')
}

/** Exclusive end line (0-based) of a heading's section: the next heading at the same or a higher level. */
export function headingSectionEnd(
  meta: NoteMeta,
  startLine: number,
  level: number,
  total: number
): number {
  let end = total
  for (const h of meta.headings) {
    if (h.line > startLine && h.level <= level) {
      end = Math.min(end, h.line)
      break
    }
  }
  return end
}

/** Trailing blank lines removed, so an embed card doesn't end in dead space. */
function trimTrailingBlanks(lines: string[]): string[] {
  const out = [...lines]
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  return out
}

/**
 * The text an embed of `section` within `meta` should show, or null when the
 * section doesn't exist in the note (an unresolved `#Heading` / `#^id`).
 * `section` carries the leading `^` for block refs, matching
 * `splitWikiTarget`'s output; pass null for a whole-note embed.
 */
export function sliceEmbedSection(
  content: string,
  meta: NoteMeta,
  section: string | null
): string | null {
  if (section === null || section === '') {
    return trimTrailingBlanks(stripFrontmatter(content).split(/\r?\n/)).join('\n')
  }

  const lines = content.split(/\r?\n/)

  if (section.startsWith('^')) {
    const id = section.slice(1).toLowerCase()
    const ref = meta.blockIds.find((b) => b.id.toLowerCase() === id)
    if (!ref || ref.line >= lines.length) return null
    // A task's own detail block travels with it; ownNoteBlockEnd stops before
    // the next checkbox of any depth, so a sibling task is never swept in.
    const indent = TASK_LINE_RE.exec(lines[ref.line])?.[1].length ?? 0
    const end = ownNoteBlockEnd(lines, ref.line, indent)
    return trimTrailingBlanks(lines.slice(ref.line, end)).join('\n')
  }

  const heading = meta.headings.find((h) => h.text.toLowerCase() === section.toLowerCase())
  if (!heading || heading.line >= lines.length) return null
  const end = headingSectionEnd(meta, heading.line, heading.level, lines.length)
  return trimTrailingBlanks(lines.slice(heading.line, end)).join('\n')
}
