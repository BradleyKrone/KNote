import { visit } from 'unist-util-visit'
import type { Node } from 'unist'
import { parse as parseYaml } from 'yaml'
import type {
  HeadingRef,
  LinkRef,
  MachineLogItem,
  MilestoneItem,
  NoteMeta,
  TagRef,
  TaskItem,
  VaultPath
} from '../types'
import { titleOf } from '../pathUtils'
import { extractTags, maskSource, type PositionedNode, type YamlBlock } from './mdScaffold'

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

export { WIKI_LINK_RE } from './patterns'
import {
  BLOCK_ID_RE,
  DATE_ENTERED_RE,
  MACHINE_ENTRY_RE,
  MILESTONE_LINE_RE,
  ownNoteBlockEnd,
  REASON_FOR_RE,
  STATUS_CHANGED_RE,
  STATUS_CHANGED_UNSET,
  TAG_RE,
  TASK_LINE_RE,
  WIKI_LINK_RE
} from './patterns'

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

/** Frontmatter → meta.frontmatter, aliases, and tags (which live on line 0). */
function collectFrontmatter(meta: NoteMeta, yaml: YamlBlock): void {
  try {
    const fm = parseYaml(yaml.value)
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

function collectHeadings(
  meta: NoteMeta,
  tree: Node,
  content: string,
  lineOf: (offset: number) => number
): void {
  visit(tree, 'heading', (node: PositionedNode) => {
    const from = node.position?.start?.offset
    const to = node.position?.end?.offset
    if (from === undefined || to === undefined) return
    const raw = content.slice(from, to)
    const text = raw
      .replace(/^#{1,6}\s*/, '')
      .replace(/\s*#+\s*$/, '')
      .trim()
    meta.headings.push({ text, level: node.depth ?? 1, line: lineOf(from) } as HeadingRef)
  })
}

function collectLinks(
  meta: NoteMeta,
  masked: string,
  content: string,
  lineStarts: number[],
  lineOf: (offset: number) => number
): void {
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
}

/** Body tags (outside code/frontmatter). Purely numeric tags are not tags (Obsidian rule). */
function collectBodyTags(meta: NoteMeta, masked: string, lineOf: (offset: number) => number): void {
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(masked)) !== null) {
    const tag = m[2]
    if (/^\d+$/.test(tag)) continue
    meta.tags.push({ tag, line: lineOf(m.index + m[1].length) } as TagRef)
  }
}

/**
 * Line-scan shared by tasks/milestones/machine-log: a line counts only when
 * the regex matches the *masked* line (so code can't produce entries), but
 * the emitted match runs against the raw line to keep original text.
 */
function scanLines(
  maskedLines: string[],
  rawLines: string[],
  re: RegExp,
  emit: (line: number, rawMatch: RegExpExecArray, rawLine: string) => void
): void {
  for (let i = 0; i < maskedLines.length; i++) {
    if (!re.exec(maskedLines[i].replace(/\r$/, ''))) continue
    const rawLine = rawLines[i].replace(/\r$/, '')
    const rawMatch = re.exec(rawLine)
    if (!rawMatch) continue
    emit(i, rawMatch, rawLine)
  }
}

function collectTasks(meta: NoteMeta, maskedLines: string[], rawLines: string[]): void {
  // \r-stripped once, up front — ownNoteBlockEnd/STATUS_CHANGED_RE/DATE_ENTERED_RE
  // anchor on $ and a trailing \r (CRLF files) would defeat that.
  const cleanLines = rawLines.map((l) => l.replace(/\r$/, ''))

  // Open ancestor task indents, so a checkbox indented deeper than the
  // nearest preceding task above it is treated as that task's subtask.
  const taskIndentStack: number[] = []
  scanLines(maskedLines, rawLines, TASK_LINE_RE, (line, rawMatch, rawLine) => {
    const text = (rawMatch[4] ?? '').trim()
    const indent = rawMatch[1].length
    while (taskIndentStack.length && taskIndentStack[taskIndentStack.length - 1] >= indent) {
      taskIndentStack.pop()
    }
    const isSubtask = taskIndentStack.length > 0
    taskIndentStack.push(indent)

    // An immediately-following, more-indented `Reason for <Column>: ...` line
    // is this task's attached waiting reason (same nesting as a task note).
    let waitingSince: string | null = null
    let waitingReason: string | null = null
    const nextRaw = line + 1 < rawLines.length ? cleanLines[line + 1] : null
    if (nextRaw !== null) {
      const reasonMatch = REASON_FOR_RE.exec(nextRaw)
      if (reasonMatch && reasonMatch[1].length > indent) {
        waitingReason = reasonMatch[3]
        waitingSince = reasonMatch[4]
      }
    }

    // `Status Changed`/`Date Entered` lines attached under the task, wherever
    // they sit in its own note block (a blank line or the other of the pair
    // may come first — see `ownNoteBlockEnd`).
    let statusChanged: string | null = null
    let dateEntered: string | null = null
    const blockEnd = ownNoteBlockEnd(cleanLines, line, indent)
    for (let i = line + 1; i < blockEnd; i++) {
      const l = cleanLines[i]
      if (statusChanged === null) {
        const sm = STATUS_CHANGED_RE.exec(l)
        if (sm) {
          statusChanged = sm[1].toLowerCase() === STATUS_CHANGED_UNSET ? null : sm[1]
          continue
        }
      }
      if (dateEntered === null) {
        const dm = DATE_ENTERED_RE.exec(l)
        if (dm) {
          dateEntered = dm[1]
          continue
        }
      }
    }

    meta.tasks.push({
      line,
      statusChar: rawMatch[3],
      text,
      indent,
      isSubtask,
      tags: extractTags(text),
      rawLine,
      waitingSince,
      waitingReason,
      statusChanged,
      dateEntered
    } as TaskItem)
  })
}

/** 🏁 lines — deliberately no checkbox brackets, so they never surface on the Kanban board. */
function collectMilestones(meta: NoteMeta, maskedLines: string[], rawLines: string[]): void {
  scanLines(maskedLines, rawLines, MILESTONE_LINE_RE, (line, rawMatch, rawLine) => {
    const text = rawMatch[1].trim()
    meta.milestones.push({ line, text, tags: extractTags(text), rawLine } as MilestoneItem)
  })
}

/** ` ^block-id` line anchors — the targets of [[Note#^id]] block references. */
function collectBlockIds(meta: NoteMeta, maskedLines: string[], rawLines: string[]): void {
  scanLines(maskedLines, rawLines, BLOCK_ID_RE, (line, rawMatch) => {
    meta.blockIds.push({ id: rawMatch[1], line })
  })
}

/** 🚜 <serial> <activity…> lines — like milestones, never Kanban cards. */
function collectMachineLog(meta: NoteMeta, maskedLines: string[], rawLines: string[]): void {
  scanLines(maskedLines, rawLines, MACHINE_ENTRY_RE, (line, rawMatch, rawLine) => {
    const text = (rawMatch[2] ?? '').trim()
    meta.machineLog.push({
      line,
      serial: rawMatch[1],
      text,
      tags: extractTags(text),
      rawLine
    } as MachineLogItem)
  })
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
    machineLog: [],
    blockIds: [],
    mtimeMs
  }

  const source = maskSource(content)
  // Unparseable content: still expose title so the note is linkable
  if (!source) return meta
  const { tree, masked, yaml } = source

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

  if (yaml) collectFrontmatter(meta, yaml)
  collectHeadings(meta, tree, content, lineOf)
  collectLinks(meta, masked, content, lineStarts, lineOf)
  collectBodyTags(meta, masked, lineOf)

  const maskedLines = masked.split('\n')
  const rawLines = content.split('\n')
  collectTasks(meta, maskedLines, rawLines)
  collectMilestones(meta, maskedLines, rawLines)
  collectMachineLog(meta, maskedLines, rawLines)
  collectBlockIds(meta, maskedLines, rawLines)

  return meta
}
