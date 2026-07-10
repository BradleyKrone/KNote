// Shared mask-then-regex scaffold used by parseNote (metadata extraction)
// and tagRename (vault-wide tag rewrite). Both need the same view of a note:
// one remark parse, then a copy of the source with frontmatter and code
// blanked out (offsets preserved) so regexes can't match inside them.

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import { visit } from 'unist-util-visit'
import type { Node } from 'unist'
import { TAG_RE } from './patterns'

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml'])

export interface PositionedNode extends Node {
  value?: string
  depth?: number
}

/** The raw YAML frontmatter block, with its [from, to) offsets in the source. */
export interface YamlBlock {
  from: number
  to: number
  value: string
}

export interface MaskedSource {
  tree: Node
  /** Source with frontmatter + code blanked to spaces, newlines/offsets preserved. */
  masked: string
  yaml: YamlBlock | null
}

/** Blank out [from, to) with spaces, preserving newlines so offsets/lines hold. */
function maskRange(chars: string[], from: number, to: number): void {
  for (let i = from; i < to && i < chars.length; i++) {
    if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' '
  }
}

/**
 * Parse markdown and blank out frontmatter and code (fenced and inline).
 * Returns null when the content can't be parsed at all.
 */
export function maskSource(content: string): MaskedSource | null {
  let tree: Node
  try {
    tree = processor.parse(content)
  } catch {
    return null
  }

  const chars = Array.from(content)
  let yaml: YamlBlock | null = null

  visit(tree, (node: PositionedNode) => {
    const from = node.position?.start?.offset
    const to = node.position?.end?.offset
    if (from === undefined || to === undefined) return
    if (node.type === 'yaml') {
      if (typeof node.value === 'string') yaml = { from, to, value: node.value }
      maskRange(chars, from, to)
    } else if (node.type === 'code' || node.type === 'inlineCode') {
      maskRange(chars, from, to)
    }
  })

  return { tree, masked: chars.join(''), yaml }
}

/** All tags in a text fragment. Purely numeric tags are not tags (Obsidian rule). */
export function extractTags(text: string): string[] {
  const tags: string[] = []
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(' ' + text)) !== null) {
    if (!/^\d+$/.test(m[2])) tags.push(m[2])
  }
  return tags
}
