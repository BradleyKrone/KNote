/**
 * Pure geometry for the Gantt grid: dates ↔ pixels, header bands, and the
 * flattened row list the tree and the chart both index into. Kept free of React
 * so every bar position is unit-testable.
 *
 * All date math is dayjs *day* arithmetic on `YYYY-MM-DD` strings — never
 * millisecond math on `Date`, which would slide every bar by a day on the two
 * DST boundaries a year.
 */

import dayjs from 'dayjs'
import type {
  PlannerDeliverable,
  PlannerMilestone,
  PlannerModel,
  PlannerProject
} from './plannerSelectors'

export type Zoom = 'day' | 'week' | 'month'

/** Pixels per day at each zoom level. */
export const PX_PER_DAY: Record<Zoom, number> = { day: 30, week: 10, month: 3.6 }

export const ROW_HEIGHT = 30

export function addDays(date: string, days: number): string {
  return dayjs(date).add(days, 'day').format('YYYY-MM-DD')
}

export function diffDays(from: string, to: string): number {
  return dayjs(to).diff(dayjs(from), 'day')
}

export function today(): string {
  return dayjs().format('YYYY-MM-DD')
}

export interface Domain {
  start: string
  end: string
  days: number
}

/**
 * The date range the chart covers: everything scheduled, padded either side,
 * and always containing today so the today line and the "scroll to today"
 * button have somewhere to land even in an empty or long-finished vault.
 */
export function domainOf(model: PlannerModel, now: string = today()): Domain {
  let min = now
  let max = now
  for (const d of model.byId.values()) {
    if (d.start < min) min = d.start
    if (d.end > max) max = d.end
    for (const m of d.milestones) {
      if (m.date < min) min = m.date
      if (m.date > max) max = m.date
    }
  }
  for (const p of model.projects) {
    for (const m of p.milestones) {
      if (m.date < min) min = m.date
      if (m.date > max) max = m.date
    }
  }
  const start = addDays(min, -14)
  const end = addDays(max, 30)
  return { start, end, days: diffDays(start, end) + 1 }
}

export function dateToX(domain: Domain, date: string, zoom: Zoom): number {
  return diffDays(domain.start, date) * PX_PER_DAY[zoom]
}

/** Center of a date's column — used for the today indicator, which should
 * read as marking that day, not the boundary before it. */
export function dateToCenterX(domain: Domain, date: string, zoom: Zoom): number {
  return dateToX(domain, date, zoom) + PX_PER_DAY[zoom] / 2
}

export function xToDate(domain: Domain, x: number, zoom: Zoom): string {
  return addDays(domain.start, Math.round(x / PX_PER_DAY[zoom]))
}

/** Whole days a horizontal pixel delta represents at this zoom. */
export function pxToDays(dx: number, zoom: Zoom): number {
  return Math.round(dx / PX_PER_DAY[zoom])
}

export function gridWidth(domain: Domain, zoom: Zoom): number {
  return domain.days * PX_PER_DAY[zoom]
}

export interface Band {
  key: string
  label: string
  x: number
  width: number
  /** Weekend or (in month zoom) quarter start — tinted in the header. */
  muted: boolean
}

/** Month band across the whole domain — the always-visible top header row. */
export function monthBands(domain: Domain, zoom: Zoom): Band[] {
  const bands: Band[] = []
  let cursor = dayjs(domain.start).startOf('month')
  const last = dayjs(domain.end)
  while (cursor.isBefore(last) || cursor.isSame(last, 'month')) {
    const from = cursor.isBefore(dayjs(domain.start)) ? dayjs(domain.start) : cursor
    const to = cursor.endOf('month').isAfter(last) ? last : cursor.endOf('month')
    const x = dateToX(domain, from.format('YYYY-MM-DD'), zoom)
    const width = (to.diff(from, 'day') + 1) * PX_PER_DAY[zoom]
    bands.push({
      key: cursor.format('YYYY-MM'),
      label: cursor.format(zoom === 'month' ? 'MMM YY' : 'MMM YYYY'),
      x,
      width,
      muted: false
    })
    cursor = cursor.add(1, 'month').startOf('month')
  }
  return bands
}

/**
 * Lower header row: one cell per day at day zoom, per week otherwise. Month
 * zoom leaves it empty — at 3.6px/day nothing legible fits, and the month band
 * above is already the ruler.
 */
export function subBands(domain: Domain, zoom: Zoom): Band[] {
  if (zoom === 'month') return []
  const bands: Band[] = []
  const px = PX_PER_DAY[zoom]
  if (zoom === 'day') {
    for (let i = 0; i < domain.days; i++) {
      const date = addDays(domain.start, i)
      const d = dayjs(date)
      const weekend = d.day() === 0 || d.day() === 6
      bands.push({ key: date, label: d.format('dd')[0], x: i * px, width: px, muted: weekend })
    }
    return bands
  }
  let cursor = dayjs(domain.start).startOf('week')
  const last = dayjs(domain.end)
  while (cursor.isBefore(last)) {
    const from = cursor.isBefore(dayjs(domain.start)) ? dayjs(domain.start) : cursor
    const to = cursor.add(6, 'day').isAfter(last) ? last : cursor.add(6, 'day')
    bands.push({
      key: cursor.format('YYYY-MM-DD'),
      label: from.format('D'),
      x: dateToX(domain, from.format('YYYY-MM-DD'), zoom),
      width: (to.diff(from, 'day') + 1) * px,
      muted: false
    })
    cursor = cursor.add(1, 'week')
  }
  return bands
}

// ---------- Rows ----------

/**
 * Fields every row carries for drag-to-reorder. `parentKey` names the scope a
 * row can be reordered within ('' for projects, `p:<slug>` for a project's
 * children, `d:<id>` for a deliverable's) and `orderKey` is the row's id inside
 * it. Unlike `key`, `orderKey` carries no line number, so a saved order
 * survives lines being inserted above a task.
 */
interface RowOrder {
  parentKey: string
  orderKey: string
}

export type PlannerRow = RowOrder &
  (
    | { kind: 'project'; key: string; depth: 0; number: string; project: PlannerProject }
    | {
        kind: 'deliverable'
        key: string
        depth: number
        number: string
        project: PlannerProject
        deliverable: PlannerDeliverable
      }
    | {
        kind: 'task'
        key: string
        depth: number
        number: string
        deliverable: PlannerDeliverable
        task: PlannerDeliverable['tasks'][number]
      }
    | {
        kind: 'milestone'
        key: string
        depth: number
        number: string
        milestone: PlannerMilestone
        deliverable?: PlannerDeliverable
      }
  )

/**
 * The user's drag-to-reorder overrides, `VaultConfig.plannerOrder`: scope
 * (`parentKey`) → `orderKey`s in the order they were left in.
 */
export type PlannerOrder = Readonly<Record<string, readonly string[]>>

/**
 * `items` reordered by a saved order: every item `saved` names comes first, in
 * that order, and everything it doesn't (a deliverable created since, say)
 * follows in its default order. Keys in `saved` that match nothing are
 * ignored, so a deleted row never leaves a hole.
 */
export function applyOrder<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  saved: readonly string[] | undefined
): T[] {
  if (!saved || saved.length === 0) return [...items]
  const rank = new Map(saved.map((key, i) => [key, i]))
  return items
    .map((item, i) => ({ item, i, r: rank.get(keyOf(item)) }))
    .sort((a, b) => {
      if (a.r !== undefined && b.r !== undefined) return a.r - b.r
      if (a.r !== undefined) return -1
      if (b.r !== undefined) return 1
      return a.i - b.i
    })
    .map((x) => x.item)
}

/**
 * `keys` with `dragged` moved to just before or after `target`. Unchanged when
 * either key is missing or they're the same row.
 */
export function moveInOrder(
  keys: readonly string[],
  dragged: string,
  target: string,
  position: 'before' | 'after'
): string[] {
  if (dragged === target || !keys.includes(dragged) || !keys.includes(target)) return [...keys]
  const rest = keys.filter((k) => k !== dragged)
  const at = rest.indexOf(target) + (position === 'after' ? 1 : 0)
  rest.splice(at, 0, dragged)
  return rest
}

export const projectOrderKey = (project: PlannerProject): string => `p:${project.slug}`
export const deliverableOrderKey = (deliverable: PlannerDeliverable): string =>
  `d:${deliverable.id}`
const taskOrderKey = (task: PlannerDeliverable['tasks'][number]): string =>
  `t:${task.path}::${task.text}`
const milestoneOrderKey = (milestone: PlannerMilestone): string =>
  `m:${milestone.path}::${milestone.text}`

/** One child of a project or deliverable, before it is numbered. */
type Child =
  | { kind: 'deliverable'; orderKey: string; deliverable: PlannerDeliverable }
  | { kind: 'task'; orderKey: string; task: PlannerDeliverable['tasks'][number] }
  | { kind: 'milestone'; orderKey: string; milestone: PlannerMilestone }

/**
 * Flattens the model into the numbered row list both panes render, honouring
 * which projects/deliverables are collapsed. Row order *is* the vertical
 * layout: a row's y is its index × ROW_HEIGHT in both panes, which is what lets
 * one scroll container drive them together.
 *
 * By default a deliverable's own `workPackages` are pushed before its
 * tasks/milestones, so a work package's own work always sits directly under
 * it rather than after every sibling work package's. `order` (the user's
 * drag-to-reorder) then rearranges siblings within each scope; numbering is
 * assigned after that, so `1.2` is always the second row on screen. Nesting is
 * capped at one level (see `deliverableDefinitions`), but `pushDeliverable`
 * recurses generically rather than assuming that.
 */
export function flattenRows(
  model: PlannerModel,
  collapsed: ReadonlySet<string>,
  projectFilter: string | null = null,
  /** Slugs unticked in the Projects sidebar — off the chart entirely. */
  hidden: ReadonlySet<string> = new Set(),
  order: PlannerOrder = {}
): PlannerRow[] {
  const rows: PlannerRow[] = []

  const pushChildren = (
    project: PlannerProject,
    parentKey: string,
    children: Child[],
    depth: number,
    prefix: string,
    owner: PlannerDeliverable | undefined
  ): void => {
    applyOrder(children, (c) => c.orderKey, order[parentKey]).forEach((child, i) => {
      const number = `${prefix}.${i + 1}`
      if (child.kind === 'deliverable') {
        pushDeliverable(project, child.deliverable, parentKey, depth, number)
      } else if (child.kind === 'task' && owner) {
        rows.push({
          kind: 'task',
          key: `t:${child.task.path}:${child.task.line}`,
          parentKey,
          orderKey: child.orderKey,
          depth,
          number,
          deliverable: owner,
          task: child.task
        })
      } else if (child.kind === 'milestone') {
        rows.push({
          kind: 'milestone',
          key: `m:${child.milestone.path}:${child.milestone.line}`,
          parentKey,
          orderKey: child.orderKey,
          depth,
          number,
          milestone: child.milestone,
          ...(owner ? { deliverable: owner } : {})
        })
      }
    })
  }

  const pushDeliverable = (
    project: PlannerProject,
    deliverable: PlannerDeliverable,
    parentKey: string,
    depth: number,
    number: string
  ): void => {
    const key = deliverableOrderKey(deliverable)
    rows.push({
      kind: 'deliverable',
      key,
      parentKey,
      orderKey: key,
      depth,
      number,
      project,
      deliverable
    })
    if (collapsed.has(key)) return
    pushChildren(
      project,
      key,
      [
        ...deliverable.workPackages.map((pkg): Child => ({
          kind: 'deliverable',
          orderKey: deliverableOrderKey(pkg),
          deliverable: pkg
        })),
        ...deliverable.tasks.map((task): Child => ({
          kind: 'task',
          orderKey: taskOrderKey(task),
          task
        })),
        ...deliverable.milestones.map((milestone): Child => ({
          kind: 'milestone',
          orderKey: milestoneOrderKey(milestone),
          milestone
        }))
      ],
      depth + 1,
      number,
      deliverable
    )
  }

  const visible = model.projects.filter(
    (project) => !hidden.has(project.slug) && (!projectFilter || project.slug === projectFilter)
  )
  applyOrder(visible, projectOrderKey, order['']).forEach((project, i) => {
    const key = projectOrderKey(project)
    const n = String(i + 1)
    rows.push({ kind: 'project', key, parentKey: '', orderKey: key, depth: 0, number: n, project })
    if (collapsed.has(key)) return
    pushChildren(
      project,
      key,
      [
        ...project.deliverables.map((deliverable): Child => ({
          kind: 'deliverable',
          orderKey: deliverableOrderKey(deliverable),
          deliverable
        })),
        ...project.milestones.map((milestone): Child => ({
          kind: 'milestone',
          orderKey: milestoneOrderKey(milestone),
          milestone
        }))
      ],
      1,
      n,
      undefined
    )
  })
  return rows
}

/**
 * Every `orderKey` in `scope`, in display order — what a drop rewrites. Read
 * from the model rather than the visible rows, so a scope that is partly
 * filtered out (a hidden project, say) keeps its hidden members' places.
 */
export function scopeOrderKeys(model: PlannerModel, scope: string, order: PlannerOrder): string[] {
  let keys: string[]
  if (scope === '') {
    keys = model.projects.map(projectOrderKey)
  } else if (scope.startsWith('p:')) {
    const project = model.projects.find((p) => projectOrderKey(p) === scope)
    keys = project
      ? [
          ...project.deliverables.map(deliverableOrderKey),
          ...project.milestones.map(milestoneOrderKey)
        ]
      : []
  } else {
    const deliverable = model.byId.get(scope.slice(2))
    keys = deliverable
      ? [
          ...deliverable.workPackages.map(deliverableOrderKey),
          ...deliverable.tasks.map(taskOrderKey),
          ...deliverable.milestones.map(milestoneOrderKey)
        ]
      : []
  }
  return applyOrder(keys, (k) => k, order[scope])
}

/** Blank space above each project group — the visual break between projects. */
export const GROUP_GAP = 18

/**
 * The y offset of every row, with `GROUP_GAP` inserted above each project but
 * the first. Rows are no longer a flat `index × ROW_HEIGHT`, so this is the one
 * place that knows where a row sits — the tree pane, the bars and the
 * dependency arrows all read it, which is what keeps the two panes aligned to
 * the pixel.
 */
export function rowTops(rows: readonly PlannerRow[]): number[] {
  const tops: number[] = []
  let y = 0
  rows.forEach((row, i) => {
    if (row.kind === 'project' && i > 0) y += GROUP_GAP
    tops.push(y)
    y += ROW_HEIGHT
  })
  return tops
}

/** Total height of the row stack, gaps included. */
export function rowsHeight(rows: readonly PlannerRow[]): number {
  const tops = rowTops(rows)
  return tops.length === 0 ? 0 : tops[tops.length - 1] + ROW_HEIGHT
}

/** Vertical centre of a row — where a bar sits and an arrow connects. */
export function rowCenter(tops: readonly number[], index: number): number {
  return (tops[index] ?? 0) + ROW_HEIGHT / 2
}

/** Row index of every deliverable, for placing dependency arrows. */
export function rowIndexById(rows: readonly PlannerRow[]): Map<string, number> {
  const index = new Map<string, number>()
  rows.forEach((row, i) => {
    if (row.kind === 'deliverable') index.set(row.deliverable.id, i)
  })
  return index
}

/**
 * Elbow polyline from a predecessor bar's right edge to a dependent bar's left
 * edge, routed around whichever way the two rows sit — the classic
 * finish-to-start connector.
 */
export function arrowPath(
  fromX: number,
  y1: number,
  toX: number,
  y2: number,
  barHeight: number
): string {
  const gap = 10
  if (toX >= fromX + gap * 2) {
    const mid = toX - gap
    return `M ${fromX} ${y1} H ${mid} V ${y2} H ${toX}`
  }
  // Dependent starts at or before its predecessor's finish: route below the
  // predecessor's row so the line never disappears under the bars.
  const below = y1 + (y2 > y1 ? barHeight / 2 + 6 : -(barHeight / 2 + 6))
  return `M ${fromX} ${y1} H ${fromX + gap} V ${below} H ${toX - gap} V ${y2} H ${toX}`
}
