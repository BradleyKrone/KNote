// Pure selectors behind the Home page's cards. Everything is derived from the
// same selectors the board and planner use (collectCards, dueState,
// buildPlannerModel), so Home can never disagree with either about what's in
// progress, what's due or when a deliverable ends.

import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import type { BoardColumn, NoteMeta, VaultConfig } from '@shared/types'
import {
  collectCards,
  columnForChar,
  dueState,
  followUpState,
  type BoardCard,
  type BoardFilters
} from '../board/boardSelectors'
import {
  buildPlannerModel,
  deliverableBarStatus,
  type PlannerDeliverable,
  type PlannerMilestone
} from '../planner/plannerSelectors'

dayjs.extend(customParseFormat)

type BoardConfig = Pick<
  VaultConfig,
  'columns' | 'boardHiddenProjects' | 'boardHiddenRoots' | 'boardSortByPriority'
>

/** The board cards Home starts from: the global board, with the board's own sidebar filters. */
function boardCards(
  notes: Map<string, NoteMeta>,
  config: BoardConfig,
  mountNames: readonly string[]
): BoardCard[] {
  const filters: BoardFilters = {
    tag: null,
    text: '',
    hiddenProjects: new Set(config.boardHiddenProjects),
    hiddenRoots: new Set(config.boardHiddenRoots),
    mountNames
  }
  return collectCards(notes, { kind: 'global' }, filters)
}

const isDone = (card: Pick<BoardCard, 'statusChar'>): boolean => /^[xX]$/.test(card.statusChar)

/**
 * Index of the "In Progress" column, or -1. Columns are user-configurable, so
 * it's found by the conventional `/` char first and only then by name.
 */
export function inProgressColumn(columns: BoardColumn[]): number {
  const byChar = columns.findIndex((c) => c.char === '/')
  if (byChar !== -1) return byChar
  return columns.findIndex((c) => /progress/i.test(c.name))
}

/** Whole days since a card's `Status Changed` stamp (M/D/YYYY), or null without one. */
export function daysSince(statusChanged: string | null, today: string): number | null {
  if (!statusChanged) return null
  const d = dayjs(statusChanged, 'M/D/YYYY')
  if (!d.isValid()) return null
  return Math.max(0, dayjs(today).diff(d, 'day'))
}

/** Cards in the In Progress column — highest priority, then soonest due, first. */
export function inProgressCards(
  notes: Map<string, NoteMeta>,
  config: BoardConfig,
  mountNames: readonly string[]
): BoardCard[] {
  const column = inProgressColumn(config.columns)
  if (column === -1) return []
  return boardCards(notes, config, mountNames)
    .filter((card) => columnForChar(config.columns, card.statusChar) === column)
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
        a.path.localeCompare(b.path) ||
        a.line - b.line
    )
}

export interface DueBuckets {
  overdue: BoardCard[]
  today: BoardCard[]
  /** Due within the next seven days (the board's green 'soon' band). */
  soon: BoardCard[]
  /** Waiting cards whose follow-up date has arrived or passed. */
  followUps: BoardCard[]
}

/** Open cards bucketed by due-date urgency, plus Waiting follow-ups that have come due. */
export function dueBuckets(
  notes: Map<string, NoteMeta>,
  config: BoardConfig,
  mountNames: readonly string[],
  today: string
): DueBuckets {
  const buckets: DueBuckets = { overdue: [], today: [], soon: [], followUps: [] }
  for (const card of boardCards(notes, config, mountNames)) {
    if (isDone(card)) continue
    const due = dueState(card, today)
    if (due === 'overdue') buckets.overdue.push(card)
    else if (due === 'today') buckets.today.push(card)
    else if (due === 'soon') buckets.soon.push(card)
    const followUp = followUpState(card, today)
    if (followUp === 'overdue' || followUp === 'today') buckets.followUps.push(card)
  }
  const byDue = (a: BoardCard, b: BoardCard): number =>
    (a.due ?? '').localeCompare(b.due ?? '') || b.priority - a.priority
  buckets.overdue.sort(byDue)
  buckets.today.sort((a, b) => b.priority - a.priority)
  buckets.soon.sort(byDue)
  buckets.followUps.sort((a, b) => (a.waitingFollowUp ?? '').localeCompare(b.waitingFollowUp ?? ''))
  return buckets
}

export interface UpcomingDeliverable {
  kind: 'deliverable'
  id: string
  label: string
  projectTitle: string
  /** Label of the deliverable this is a work package of, or null. */
  parentLabel: string | null
  path: string
  line: number
  start: string
  end: string
  percent: number
  overdue: boolean
}

export interface UpcomingMilestone {
  kind: 'milestone'
  id: string
  label: string
  projectTitle: string
  path: string
  line: number
  date: string
  important: boolean
}

export interface UpcomingPlanner {
  /** Open deliverables whose end date has passed — flagged above everything else. */
  overdue: UpcomingDeliverable[]
  /** Open deliverables running now or starting within the horizon, soonest end first. */
  deliverables: UpcomingDeliverable[]
  /** Milestones dated today through the horizon, soonest first. */
  milestones: UpcomingMilestone[]
}

/** Deliverables, overdue deliverables and milestones within `horizonDays` of `today`, from charted, open projects. */
export function upcomingPlanner(
  notes: ReadonlyMap<string, NoteMeta>,
  hiddenProjects: readonly string[],
  today: string,
  horizonDays = 30
): UpcomingPlanner {
  const horizon = dayjs(today).add(horizonDays, 'day').format('YYYY-MM-DD')
  const hidden = new Set(hiddenProjects)
  const result: UpcomingPlanner = { overdue: [], deliverables: [], milestones: [] }
  // A milestone naming several deliverables is placed under each of them.
  const seenMilestones = new Set<string>()
  const addMilestone = (m: PlannerMilestone, projectTitle: string): void => {
    if (m.date < today || m.date > horizon) return
    const item = milestone(m, projectTitle)
    if (seenMilestones.has(item.id)) return
    seenMilestones.add(item.id)
    result.milestones.push(item)
  }

  for (const project of buildPlannerModel(notes, today).projects) {
    if (project.complete || hidden.has(project.slug)) continue

    const visit = (d: PlannerDeliverable, parent: PlannerDeliverable | null): void => {
      const status = deliverableBarStatus(d, today)
      if (status !== 'done') {
        const item: UpcomingDeliverable = {
          kind: 'deliverable',
          id: d.id,
          label: d.label,
          projectTitle: project.title,
          parentLabel: parent?.label ?? null,
          path: d.path,
          line: d.line,
          start: d.start,
          end: d.end,
          percent: d.percent,
          overdue: status === 'overdue'
        }
        if (item.overdue) result.overdue.push(item)
        else if (d.start <= horizon) result.deliverables.push(item)
      }
      for (const m of d.milestones) addMilestone(m, project.title)
      for (const wp of d.workPackages) visit(wp, d)
    }

    for (const d of project.deliverables) visit(d, null)
    for (const m of project.milestones) addMilestone(m, project.title)
  }

  result.overdue.sort((a, b) => a.end.localeCompare(b.end))
  result.deliverables.sort((a, b) => a.end.localeCompare(b.end) || a.label.localeCompare(b.label))
  result.milestones.sort((a, b) => a.date.localeCompare(b.date))
  return result
}

function milestone(m: PlannerMilestone, projectTitle: string): UpcomingMilestone {
  return {
    kind: 'milestone',
    id: `${m.path}:${m.line}`,
    label: m.text,
    projectTitle,
    path: m.path,
    line: m.line,
    date: m.date,
    important: m.important
  }
}

/** Where a date span sits in a `days`-wide window starting at `windowStart`, as fractions 0–1, or null when it misses it. */
export function spanInWindow(
  start: string,
  end: string,
  windowStart: string,
  days: number
): { left: number; width: number } | null {
  const ws = dayjs(windowStart)
  const s = Math.max(0, dayjs(start).diff(ws, 'day'))
  const e = Math.min(days, dayjs(end).diff(ws, 'day') + 1)
  if (e <= 0 || s >= days || e <= s) return null
  return { left: s / days, width: (e - s) / days }
}
