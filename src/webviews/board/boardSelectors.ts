import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import type { BoardColumn, NoteMeta, VaultPath } from '@shared/types'
import { isInside, samePath, titleOf } from '@shared/pathUtils'
import {
  ARCHIVED_CHAR,
  DUE_RE,
  PRIORITY_RE,
  parseDeliverableTag,
  stripInlineMarkers
} from '@shared/parser/patterns'
import {
  definingDeliverableTag,
  deliverableMembershipOf,
  deliverableProgress,
  deliverableWindows,
  overdueDeliverables,
  visibleForDeliverable,
  type DeliverableProgress,
  type DeliverableScopeFilter
} from '@shared/deliverables'

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
  /** Deliverable(s) this card belongs to (bare `deliverable/<project>/<name>` tags), from either marker — see `deliverableMembershipOf`. */
  deliverables: string[]
  /** The bare deliverable tag this card *defines* (its own top-level line in a project note), or null for an ordinary task — including one that merely joins a deliverable. */
  definesDeliverable: string | null
  /** Member-task completion for the deliverable this card defines — set only when `definesDeliverable` is. */
  progress: DeliverableProgress | null
  /** Which of this card's `deliverables` are currently overdue (window closed, work still unfinished) — a subset of `deliverables`. Drives the red overdue treatment on the deliverable chip even when this task carries no `@due()` of its own. */
  overdueDeliverables: string[]
  due: string | null
  priority: number
  /** Follow-up date (YYYY-MM-DD) for a card sitting in a require-reason column */
  waitingFollowUp: string | null
  waitingReason: string | null
  rawLine: string
  /** Date (M/D/YYYY) the task last changed Kanban column, if it ever has */
  statusChanged: string | null
  /** Date (M/D/YYYY) the task's note template was seeded, if present */
  dateEntered: string | null
  /** The task's own note text (indented, auto-managed meta lines excluded) — what the card's task editor edits */
  noteLines: string[]
}

export function scopeLabel(scope: BoardScope): string {
  if (scope.kind === 'global') return 'All notes'
  if (scope.kind === 'folder') return scope.path + '/'
  return titleOf(scope.path)
}

export function toCard(
  meta: NoteMeta,
  task: NoteMeta['tasks'][number],
  progress?: ReadonlyMap<string, DeliverableProgress>,
  overdueTags?: ReadonlySet<string>
): BoardCard {
  const due = DUE_RE.exec(task.text)
  const prio = PRIORITY_RE.exec(task.text)
  const displayText = stripInlineMarkers(task.text)
  // Board cards are only ever built for top-level tasks (collectCards skips
  // isSubtask before calling toCard), so `true` here is always correct.
  // requireSpan: true — a card only counts as *the* deliverable when it
  // actually carries the 🛫/📅 span, not just the marker; otherwise a plain
  // top-level task in the project note that merely joins the same deliverable
  // (no dates of its own) would be mistaken for a second defining line.
  const definesDeliverable = definingDeliverableTag(task.text, true, meta, true)
  const deliverables = deliverableMembershipOf(task.tags, task.text)
  return {
    path: meta.path,
    noteTitle: meta.title,
    line: task.line,
    statusChar: task.statusChar,
    text: task.text,
    displayText: displayText || task.text,
    tags: task.tags,
    deliverables,
    definesDeliverable,
    progress: definesDeliverable
      ? (progress?.get(definesDeliverable) ?? { done: 0, total: 0 })
      : null,
    overdueDeliverables: overdueTags ? deliverables.filter((tag) => overdueTags.has(tag)) : [],
    due: due ? (due[1] ?? due[2]) : null,
    priority: prio ? prio[1].length : 0,
    waitingFollowUp: task.waitingFollowUp,
    waitingReason: task.waitingReason,
    rawLine: task.rawLine,
    statusChanged: task.statusChanged,
    dateEntered: task.dateEntered,
    noteLines: task.noteLines
  }
}

/** How urgent a card's date is — drives the colour of its due / follow-up chip. */
export type DueState = 'overdue' | 'today' | 'soon' | 'later'

/** Days ahead of `today` a date still counts as 'soon' (green). */
const SOON_DAYS = 7

/**
 * The board's one date-urgency rule, shared by due dates and Waiting
 * follow-up dates so they can never drift apart. `date` and `today` are both
 * YYYY-MM-DD, which dayjs parses natively.
 */
function dateUrgency(date: string, today: string): DueState {
  const days = dayjs(date).diff(dayjs(today), 'day')
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  return days <= SOON_DAYS ? 'soon' : 'later'
}

/**
 * Colour bucket for a card's due date, relative to `today` (YYYY-MM-DD).
 * Null when the card has no due date at all. Done cards always read 'later' —
 * work you've already finished shouldn't keep showing up as overdue.
 */
export function dueState(
  card: Pick<BoardCard, 'due' | 'statusChar'>,
  today: string
): DueState | null {
  if (!card.due) return null
  if (/^[xX]$/.test(card.statusChar)) return 'later'
  return dateUrgency(card.due, today)
}

/**
 * Colour bucket for a card's Waiting follow-up date, on exactly the same
 * scale as `dueState` — a follow-up you've blown past reads red the way an
 * overdue task does. Null when the card carries no follow-up date, which is
 * every card outside a require-reason column (the reason line, and the date
 * on it, is deleted on the way out).
 */
export function followUpState(
  card: Pick<BoardCard, 'waitingFollowUp' | 'statusChar'>,
  today: string
): DueState | null {
  if (!card.waitingFollowUp) return null
  if (/^[xX]$/.test(card.statusChar)) return 'later'
  return dateUrgency(card.waitingFollowUp, today)
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
  /** Escape hatch for the deliverable-window gate below — the board's "Show all deliverable tasks" toggle. */
  ignoreDeliverableWindow?: boolean
  /** The Boards tree's project/deliverable/unassigned pick — orthogonal to `tag`, both apply together. */
  deliverableScope?: DeliverableScopeFilter
}

function matchesDeliverableScope(
  card: Pick<BoardCard, 'deliverables'>,
  scope: DeliverableScopeFilter
): boolean {
  if (!scope || scope.kind === 'all') return true
  if (scope.kind === 'unassigned') return card.deliverables.length === 0
  if (scope.kind === 'project')
    return card.deliverables.some((t) => parseDeliverableTag(t)?.project === scope.slug)
  return card.deliverables.includes(scope.tag)
}

export function collectCards(
  notes: Map<string, NoteMeta>,
  scope: BoardScope,
  filters: BoardFilters
): BoardCard[] {
  const cards: BoardCard[] = []
  // Project work only belongs on the board while its deliverable is actually
  // running (or overdue) — see visibleForDeliverable. Both views read the same
  // index map, so this needs nothing from the host.
  const windows = filters.ignoreDeliverableWindow ? null : deliverableWindows(notes)
  const progress = deliverableProgress(notes)
  const now = dayjs().format('YYYY-MM-DD')
  const overdueTags = overdueDeliverables(notes, now)
  for (const meta of notes.values()) {
    if (scope.kind === 'note' && !samePath(meta.path, scope.path)) continue
    if (scope.kind === 'folder' && !isInside(meta.path, scope.path)) continue
    for (const task of meta.tasks) {
      if (task.statusChar === ARCHIVED_CHAR) continue
      if (task.isSubtask) continue
      if (windows && !visibleForDeliverable(task, windows, now)) continue
      const card = toCard(meta, task, progress, overdueTags)
      if (
        filters.tag &&
        !card.tags.some((t) => t === filters.tag || t.startsWith(filters.tag + '/'))
      )
        continue
      if (!matchesDeliverableScope(card, filters.deliverableScope ?? null)) continue
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
  // Ignores the deliverable-window gate on purpose: the tag dropdown shouldn't
  // lose entries as deliverables open and close.
  for (const card of collectCards(notes, scope, {
    tag: null,
    text: '',
    ignoreDeliverableWindow: true
  })) {
    for (const t of card.tags) tags.add(t)
  }
  return [...tags].sort()
}
