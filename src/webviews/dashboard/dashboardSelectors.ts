// Pure view-model for the Home dashboard. Everything here layers over the
// existing board and timeline selectors so the dashboard stays a presentation
// layer, and stays DOM-free so vitest can exercise it directly.

import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import type { BoardColumn, HeadingRef, NoteMeta, VaultConfig, VaultPath } from '@shared/types'
import { joinRel } from '@shared/pathUtils'
import { collectCards, groupByColumn, type BoardCard, type BoardScope } from '../board/boardSelectors'
import { collectTimelineItems, type TimelineItem } from '../timeline/timelineSelectors'

dayjs.extend(isoWeek)

const GLOBAL: BoardScope = { kind: 'global' }
const NO_FILTERS = { tag: null, text: '' }

function isDoneChar(char: string): boolean {
  return /^[xX]$/.test(char)
}

/** A note whose dated timeline entry is a real deadline (`due:`/`deadline:`), not a plain `date:` (often just a creation date). */
function isNoteDeadline(item: TimelineItem): boolean {
  return item.kind === 'note' && (item.frontmatterKey === 'due' || item.frontmatterKey === 'deadline')
}

/** Forward-looking things worth showing: dated tasks, milestones, and note due/deadline props. */
function isUpcomingCandidate(item: TimelineItem): boolean {
  return item.kind === 'task' || item.kind === 'milestone' || isNoteDeadline(item)
}

/** A due date you could actually miss: a task or a note due/deadline. Milestones are targets with no completion state, so they don't count as "overdue". */
function isMissableDeadline(item: TimelineItem): boolean {
  return item.kind === 'task' || isNoteDeadline(item)
}

/** All timeline items flattened into one date-ascending list (the map is already date-sorted). */
function flatTimeline(notes: Map<string, NoteMeta>): TimelineItem[] {
  const out: TimelineItem[] = []
  for (const items of collectTimelineItems(notes).values()) out.push(...items)
  return out
}

/** Not-yet-done deadlines due today or later, soonest first. */
export function upcomingDeadlines(
  notes: Map<string, NoteMeta>,
  today: string,
  limit = 6
): TimelineItem[] {
  return flatTimeline(notes)
    .filter((i) => !i.done && i.date >= today && isUpcomingCandidate(i))
    .slice(0, limit)
}

/** Not-yet-done deadlines whose date has already passed, oldest first. */
export function overdueDeadlines(notes: Map<string, NoteMeta>, today: string): TimelineItem[] {
  return flatTimeline(notes).filter((i) => !i.done && i.date < today && isMissableDeadline(i))
}

/** Index of the "In Progress" board column: the one whose char is `/`, else one named …progress…, else -1. */
export function inProgressColumnIndex(columns: BoardColumn[]): number {
  const byChar = columns.findIndex((c) => c.char === '/')
  if (byChar !== -1) return byChar
  return columns.findIndex((c) => /progress/i.test(c.name))
}

/** Cards currently in the In Progress column — "what I'm working on". */
export function inProgressCards(notes: Map<string, NoteMeta>, columns: BoardColumn[]): BoardCard[] {
  const idx = inProgressColumnIndex(columns)
  if (idx === -1) return []
  return groupByColumn(collectCards(notes, GLOBAL, NO_FILTERS), columns)[idx]
}

export interface ColumnCount {
  name: string
  char: string
  count: number
}

export interface TaskStats {
  /** Every board card (top-level, non-archived task) across the vault */
  total: number
  open: number
  done: number
  overdue: number
  columns: ColumnCount[]
}

/** At-a-glance task counts for the stats strip. */
export function taskStats(
  notes: Map<string, NoteMeta>,
  columns: BoardColumn[],
  today: string
): TaskStats {
  const cards = collectCards(notes, GLOBAL, NO_FILTERS)
  const grouped = groupByColumn(cards, columns)
  const done = cards.filter((c) => isDoneChar(c.statusChar)).length
  return {
    total: cards.length,
    open: cards.length - done,
    done,
    overdue: overdueDeadlines(notes, today).length,
    columns: columns.map((c, i) => ({ name: c.name, char: c.char, count: grouped[i].length }))
  }
}

/** Vault path of this week's note (may or may not exist yet), mirroring weeklyNotes.ensureThisWeekNote. */
export function thisWeekNotePath(config: VaultConfig, now: dayjs.Dayjs = dayjs()): VaultPath {
  const name = now.startOf('isoWeek').format(config.weeklyFormat)
  return joinRel(config.weeklyFolder, name + '.md')
}

/** The `M/D/YYYY` label a day heading uses inside a weekly note (see templates.weekdaysBlock). */
export function dayHeadingLabel(date: string): string {
  return dayjs(date).format('M/D/YYYY')
}

export interface DaySection {
  /** Full heading text, e.g. "7/18/2026 (Saturday)" */
  heading: string
  /** 0-based line of the heading */
  line: number
  /** Body lines under the heading (up to the next heading), trimmed of surrounding blanks */
  body: string[]
}

/**
 * Extract the body under the first heading whose text starts with `dayLabel`
 * (a `M/D/YYYY` day label), up to the next heading of any level. Returns null
 * when there's no such heading.
 */
export function extractDaySection(
  content: string,
  headings: HeadingRef[],
  dayLabel: string
): DaySection | null {
  const heading = headings.find((h) => h.text.startsWith(dayLabel))
  if (!heading) return null
  const lines = content.split(/\r?\n/)
  const nextHeadingLine = headings
    .map((h) => h.line)
    .filter((l) => l > heading.line)
    .reduce((min, l) => Math.min(min, l), lines.length)
  const body = lines.slice(heading.line + 1, nextHeadingLine)
  while (body.length && body[body.length - 1].trim() === '') body.pop()
  while (body.length && body[0].trim() === '') body.shift()
  return { heading: heading.text, line: heading.line, body }
}
