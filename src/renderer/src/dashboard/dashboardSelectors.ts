import dayjs from 'dayjs'
import type { BoardColumn, NoteMeta, VaultPath } from '@shared/types'
import { collectCards, columnForChar, type BoardCard } from '@/board/boardSelectors'
import { collectTimelineItems, type TimelineItem } from '@/timeline/timelineSelectors'

/** Whether a Dashboard link target is an external URL (vs. a note reference). */
export function isExternalLink(target: string): boolean {
  return /^https?:\/\//i.test(target.trim())
}

/** Case-insensitive lookup of a board column by its display name. */
export function findColumnByName(columns: BoardColumn[], name: string): BoardColumn | null {
  const target = name.trim().toLowerCase()
  return columns.find((c) => c.name.trim().toLowerCase() === target) ?? null
}

/** All non-archived, non-subtask cards sitting in the "In Progress" column. */
export function inProgressCards(notes: Map<string, NoteMeta>, columns: BoardColumn[]): BoardCard[] {
  const column = findColumnByName(columns, 'In Progress')
  if (!column) return []
  const cards = collectCards(notes, { kind: 'global' }, { tag: null, text: '' })
  return cards.filter((card) => columnForChar(columns, card.statusChar) === columns.indexOf(column))
}

export interface PinnedNoteEntry {
  path: VaultPath
  title: string
  missing: boolean
}

/** Pinned notes resolved against the live index, preserving pin order. */
export function pinnedNoteEntries(
  notes: Map<string, NoteMeta>,
  pinnedPaths: VaultPath[]
): PinnedNoteEntry[] {
  return pinnedPaths.map((path) => {
    const meta = notes.get(path)
    return meta
      ? { path, title: meta.title, missing: false }
      : { path, title: path, missing: true }
  })
}

export interface UpcomingDeadlines {
  overdue: TimelineItem[]
  upcoming: TimelineItem[]
}

/** Undone dated items split into overdue (before `today`) and upcoming (from `today`), each capped. */
export function upcomingDeadlines(
  notes: Map<string, NoteMeta>,
  today: string,
  options: { horizonDays?: number; limit?: number } = {}
): UpcomingDeadlines {
  const horizonDays = options.horizonDays ?? 14
  const limit = options.limit ?? 20
  const horizon = dayjs(today).add(horizonDays, 'day').format('YYYY-MM-DD')

  const overdue: TimelineItem[] = []
  const upcoming: TimelineItem[] = []
  for (const items of collectTimelineItems(notes).values()) {
    for (const item of items) {
      if (item.done) continue
      if (item.date < today) overdue.push(item)
      else if (item.date <= horizon) upcoming.push(item)
    }
  }
  return { overdue: overdue.slice(0, limit), upcoming: upcoming.slice(0, limit) }
}
