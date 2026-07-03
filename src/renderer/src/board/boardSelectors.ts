import type { BoardColumn, NoteMeta, VaultPath } from '@shared/types'
import { isInside, samePath, titleOf } from '@shared/pathUtils'
import { ARCHIVED_CHAR, DUE_RE, PRIORITY_RE } from '@shared/parser/patterns'

export type BoardScope =
  | { kind: 'global' }
  | { kind: 'folder'; path: VaultPath }
  | { kind: 'note'; path: VaultPath }

export interface BoardCard {
  path: VaultPath
  noteTitle: string
  line: number
  statusChar: string
  text: string
  /** Task text with tags/due/priority markers stripped, for display */
  displayText: string
  tags: string[]
  due: string | null
  priority: number
  rawLine: string
}

export function scopeLabel(scope: BoardScope): string {
  if (scope.kind === 'global') return 'All notes'
  if (scope.kind === 'folder') return scope.path + '/'
  return titleOf(scope.path)
}

/** Strip due-date/priority/tag markers out of raw task-or-milestone text, for display. */
export function stripInlineMarkers(text: string): string {
  return text
    .replace(DUE_RE, '')
    .replace(PRIORITY_RE, ' ')
    .replace(/(^|[\s([{])#[A-Za-z0-9_][A-Za-z0-9_/-]*/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function toCard(meta: NoteMeta, task: NoteMeta['tasks'][number]): BoardCard {
  const due = DUE_RE.exec(task.text)
  const prio = PRIORITY_RE.exec(task.text)
  const displayText = stripInlineMarkers(task.text)
  return {
    path: meta.path,
    noteTitle: meta.title,
    line: task.line,
    statusChar: task.statusChar,
    text: task.text,
    displayText: displayText || task.text,
    tags: task.tags,
    due: due ? (due[1] ?? due[2]) : null,
    priority: prio ? prio[1].length : 0,
    rawLine: task.rawLine
  }
}

export interface BoardFilters {
  tag: string | null
  text: string
}

export function collectCards(
  notes: Map<string, NoteMeta>,
  scope: BoardScope,
  filters: BoardFilters
): BoardCard[] {
  const cards: BoardCard[] = []
  for (const meta of notes.values()) {
    if (scope.kind === 'note' && !samePath(meta.path, scope.path)) continue
    if (scope.kind === 'folder' && !isInside(meta.path, scope.path)) continue
    for (const task of meta.tasks) {
      if (task.statusChar === ARCHIVED_CHAR) continue
      const card = toCard(meta, task)
      if (filters.tag && !card.tags.some((t) => t === filters.tag || t.startsWith(filters.tag + '/')))
        continue
      if (filters.text && !card.text.toLowerCase().includes(filters.text.toLowerCase())) continue
      cards.push(card)
    }
  }
  // Stable, markdown-derivable order: by note path, then line number
  cards.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
  return cards
}

/** Which column a status char belongs to; unknown chars land in column 0. */
export function columnForChar(columns: BoardColumn[], char: string): number {
  const norm = char === 'X' ? 'x' : char
  const idx = columns.findIndex((c) => c.char === norm)
  return idx === -1 ? 0 : idx
}

export function groupByColumn(cards: BoardCard[], columns: BoardColumn[]): BoardCard[][] {
  const out: BoardCard[][] = columns.map(() => [])
  for (const card of cards) out[columnForChar(columns, card.statusChar)].push(card)
  return out
}

/** All tags present on the (unfiltered) card set, for the filter dropdown. */
export function boardTags(notes: Map<string, NoteMeta>, scope: BoardScope): string[] {
  const tags = new Set<string>()
  for (const card of collectCards(notes, scope, { tag: null, text: '' })) {
    for (const t of card.tags) tags.add(t)
  }
  return [...tags].sort()
}
