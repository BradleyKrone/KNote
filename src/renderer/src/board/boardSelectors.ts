import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import type { BoardColumn, NoteMeta, VaultPath } from '@shared/types'
import { isInside, samePath, titleOf } from '@shared/pathUtils'
import { ARCHIVED_CHAR, DUE_RE, PRIORITY_RE } from '@shared/parser/patterns'

dayjs.extend(isoWeek)

export type BoardScope =
  { kind: 'global' } | { kind: 'folder'; path: VaultPath } | { kind: 'note'; path: VaultPath }

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
  waitingSince: string | null
  waitingReason: string | null
  rawLine: string
  /** Date (M/D/YYYY) the task last changed Kanban column, if it ever has */
  statusChanged: string | null
  /** Date (M/D/YYYY) the task's note template was seeded, if present */
  dateEntered: string | null
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
    waitingSince: task.waitingSince,
    waitingReason: task.waitingReason,
    rawLine: task.rawLine,
    statusChanged: task.statusChanged,
    dateEntered: task.dateEntered
  }
}

/** A Status Changed / Date Entered / Due Date board filter. */
export type DateRangeFilter =
  | { kind: 'any' }
  | { kind: 'today' }
  | { kind: 'week' }
  | { kind: 'date'; date: string } // YYYY-MM-DD
  | { kind: 'range'; from: string; to: string } // YYYY-MM-DD, either may be blank

export const ANY_DATE_FILTER: DateRangeFilter = { kind: 'any' }

/** Parses a card date value, which is either YYYY-MM-DD (due) or M/D/YYYY (Status Changed/Date Entered). */
function parseCardDate(value: string | null): dayjs.Dayjs | null {
  if (!value) return null
  const d = dayjs(value, ['YYYY-MM-DD', 'M/D/YYYY'], true)
  return d.isValid() ? d : null
}

export function matchesDateFilter(value: string | null, filter: DateRangeFilter): boolean {
  if (filter.kind === 'any') return true
  const d = parseCardDate(value)
  if (!d) return false
  switch (filter.kind) {
    case 'today':
      return d.isSame(dayjs(), 'day')
    case 'week':
      return d.isSame(dayjs(), 'isoWeek')
    case 'date':
      return d.isSame(dayjs(filter.date), 'day')
    case 'range':
      if (filter.from && d.isBefore(dayjs(filter.from), 'day')) return false
      if (filter.to && d.isAfter(dayjs(filter.to), 'day')) return false
      return true
  }
}

export interface BoardFilters {
  tag: string | null
  text: string
  statusChanged?: DateRangeFilter
  dateEntered?: DateRangeFilter
  due?: DateRangeFilter
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
      if (task.isSubtask) continue
      const card = toCard(meta, task)
      if (
        filters.tag &&
        !card.tags.some((t) => t === filters.tag || t.startsWith(filters.tag + '/'))
      )
        continue
      if (filters.text && !card.text.toLowerCase().includes(filters.text.toLowerCase())) continue
      if (!matchesDateFilter(card.statusChanged, filters.statusChanged ?? ANY_DATE_FILTER)) continue
      if (!matchesDateFilter(card.dateEntered, filters.dateEntered ?? ANY_DATE_FILTER)) continue
      if (!matchesDateFilter(card.due, filters.due ?? ANY_DATE_FILTER)) continue
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
