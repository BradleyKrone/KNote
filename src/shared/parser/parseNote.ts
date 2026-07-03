import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import { visit } from 'unist-util-visit'
import type { Node } from 'unist'
import { parse as parseYaml } from 'yaml'
import type { HeadingRef, LinkRef, MilestoneItem, NoteMeta, TagRef, TaskItem, VaultPath } from '../types'
import { titleOf } from '../pathUtils'

/**
 * The single-pass metadata extractor. Everything downstream — backlinks,
 * tag pane, search, the Kanban board — derives from what this returns.
 *
 * Strategy: one remark parse (for frontmatter, headings, and code ranges),
 * then regexes over a *masked* copy of the source (code and frontmatter
 * blanked out, offsets preserved) for wiki-links, tags, and task lines.
 * remark tokenizes [[..]] unpredictably, so regex-over-masked-source is
 * both simpler and byte-exact.
 */

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml'])

export { TAG_RE, TASK_LINE_RE, WIKI_LINK_RE } from './patterns'
import { MILESTONE_LINE_RE, TAG_RE, TASK_LINE_RE, WIKI_LINK_RE } from './patterns'

interface PositionedNode extends Node {
  value?: string
  depth?: number
}

function toStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean)
  }
  return []
}

/** Blank out [from, to) with spaces, preserving newlines so offsets/lines hold. */
function maskRange(chars: string[], from: number, to: number): void {
  for (let i = from; i < to && i < chars.length; i++) {
    if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' '
  }
}

export function parseNote(path: VaultPath, content: string, mtimeMs = 0): NoteMeta {
  const meta: NoteMeta = {
    path,
    title: titleOf(path),
    aliases: [],
    frontmatter: {},
    frontmatterError: false,
    headings: [],
    links: [],
    tags: [],
    tasks: [],
    milestones: [],
    mtimeMs
  }

  let tree: Node
  try {
    tree = processor.parse(content)
  } catch {
    // Unparseable content: still expose title so the note is linkable
    return meta
  }

  const chars = Array.from(content)
  const lineStarts: number[] = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineStarts.push(i + 1)
  }
  const lineOf = (offset: number): number => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  visit(tree, (node: PositionedNode) => {
    const from = node.position?.start?.offset
    const to = node.position?.end?.offset
    if (node.type === 'yaml') {
      if (typeof node.value === 'string') {
        try {
          const fm = parseYaml(node.value)
          if (fm && typeof fm === 'object' && !Array.isArray(fm)) {
            meta.frontmatter = fm as Record<string, unknown>
            meta.aliases = toStringArray(meta.frontmatter['aliases'] ?? meta.frontmatter['alias'])
            for (const t of toStringArray(meta.frontmatter['tags'] ?? meta.frontmatter['tag'])) {
              meta.tags.push({ tag: t.replace(/^#/, ''), line: 0 })
            }
          }
        } catch {
          meta.frontmatterError = true
        }
      }
      if (from !== undefined && to !== undefined) maskRange(chars, from, to)
    } else if (node.type === 'heading') {
      if (from !== undefined && to !== undefined) {
        const raw = content.slice(from, to)
        const text = raw.replace(/^#{1,6}\s*/, '').replace(/\s*#+\s*$/, '').trim()
        meta.headings.push({ text, level: node.depth ?? 1, line: lineOf(from) } as HeadingRef)
      }
    } else if (node.type === 'code' || node.type === 'inlineCode') {
      if (from !== undefined && to !== undefined) maskRange(chars, from, to)
    }
  })

  const masked = chars.join('')

  // --- Wiki links
  WIKI_LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKI_LINK_RE.exec(masked)) !== null) {
    const line = lineOf(m.index)
    const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : content.length
    const link: LinkRef = {
      target: m[2].trim(),
      embed: m[1] === '!',
      line,
      context: content.slice(lineStarts[line], lineEnd).replace(/\r$/, '')
    }
    if (m[3]) link.heading = m[3].slice(1).trim()
    if (m[4]) link.alias = m[4].slice(1).trim()
    meta.links.push(link)
  }

  // --- Tags (body). Purely numeric tags are not tags (Obsidian rule).
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(masked)) !== null) {
    const tag = m[2]
    if (/^\d+$/.test(tag)) continue
    meta.tags.push({ tag, line: lineOf(m.index + m[1].length) } as TagRef)
  }

  // --- Tasks: line-scan of the masked source (code can't produce tasks)
  const maskedLines = masked.split('\n')
  const rawLines = content.split('\n')
  for (let i = 0; i < maskedLines.length; i++) {
    const tm = TASK_LINE_RE.exec(maskedLines[i].replace(/\r$/, ''))
    if (!tm) continue
    const rawLine = rawLines[i].replace(/\r$/, '')
    const rawMatch = TASK_LINE_RE.exec(rawLine)
    if (!rawMatch) continue
    const text = (rawMatch[4] ?? '').trim()
    const taskTags: string[] = []
    TAG_RE.lastIndex = 0
    let tagMatch: RegExpExecArray | null
    while ((tagMatch = TAG_RE.exec(' ' + text)) !== null) {
      if (!/^\d+$/.test(tagMatch[2])) taskTags.push(tagMatch[2])
    }
    meta.tasks.push({
      line: i,
      statusChar: rawMatch[3],
      text,
      indent: rawMatch[1].length,
      tags: taskTags,
      rawLine
    } as TaskItem)
  }

  // --- Milestones: 🏁 lines, deliberately excluded from the task scan above
  // (no checkbox brackets) so they never surface on the Kanban board.
  for (let i = 0; i < maskedLines.length; i++) {
    const mm = MILESTONE_LINE_RE.exec(maskedLines[i].replace(/\r$/, ''))
    if (!mm) continue
    const rawLine = rawLines[i].replace(/\r$/, '')
    const rawMatch = MILESTONE_LINE_RE.exec(rawLine)
    if (!rawMatch) continue
    const text = rawMatch[1].trim()
    const milestoneTags: string[] = []
    TAG_RE.lastIndex = 0
    let milestoneTagMatch: RegExpExecArray | null
    while ((milestoneTagMatch = TAG_RE.exec(' ' + text)) !== null) {
      if (!/^\d+$/.test(milestoneTagMatch[2])) milestoneTags.push(milestoneTagMatch[2])
    }
    meta.milestones.push({
      line: i,
      text,
      tags: milestoneTags,
      rawLine
    } as MilestoneItem)
  }

  return meta
}
