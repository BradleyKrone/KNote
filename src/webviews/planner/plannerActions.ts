// Planner → file writes. Every one of them is a verified edit against an exact
// line the model already holds, so a note that changed underneath us is refused
// with KNOTE_STALE and toasted rather than clobbered.

import dayjs from 'dayjs'
import { isStaleError } from '@shared/errors'
import {
  PROJECT_COLOR_KEY,
  PROJECT_END_KEY,
  PROJECT_START_KEY,
  PROJECT_STATUS_KEY,
  deliverableRefMarker,
  slugify,
  type PlannerColor
} from '@shared/deliverables'
import { DUE_RE, parseDeliverableTag, TASK_MARKER } from '@shared/parser/patterns'
import { taskChildIndent } from '@shared/parser/taskNoteBody'
import { host } from '../shared/rpc'
import { confirm, showToast, type ConfirmChange } from '../shared/stores'
import {
  addDependency,
  removeDependency,
  setColorMarker,
  setDeliverableDates,
  setDueDate
} from '../shared/taskMeta'
import { addDays, diffDays } from './plannerLayout'
import {
  cascadeShift,
  projectWindow,
  type PlannerDeliverable,
  type PlannerModel,
  type PlannerProject
} from './plannerSelectors'

/** Run a write, turning a stale-line refusal into a toast instead of a crash. */
async function guarded(fn: () => Promise<void>, staleMessage: string): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (err) {
    if (!isStaleError(err)) throw err
    showToast(staleMessage)
    return false
  }
}

/** New span for a deliverable, clamped so a resize can never invert it. */
function spanFor(d: PlannerDeliverable, start: string, end: string): [string, string] {
  return start <= end ? [start, end] : [end, end]
}

const minDate = (a: string, b: string): string => (a < b ? a : b)
const maxDate = (a: string, b: string): string => (a > b ? a : b)

/** A window a span has to stay inside; a null side is unbounded. */
export interface Bounds {
  start: string | null
  end: string | null
}

/** A bar's dates — the shape the chart's optimistic preview draws. */
export interface PlannedSpan {
  start: string
  end: string
}

/**
 * Told every span a move/resize is about to write — once the overrun question
 * (if any) has been answered, before the first write — so the chart can draw
 * the outcome straight away instead of waiting on the index deltas. `points`
 * carries every 🏁/📅 diamond being re-dated along with them, keyed by
 * `lineKey`.
 */
export type OnPlan = (spans: Map<string, PlannedSpan>, points: Map<string, string>) => void

/** A line's identity across a batch of writes — what diamonds are keyed by in a plan. */
export const lineKey = (ref: { path: string; line: number }): string => `${ref.path}:${ref.line}`

/**
 * `date`, pulled inside `bounds` if it falls outside them. Clamping each
 * endpoint independently can never invert a span that wasn't already inverted:
 * clamping to a fixed range is monotonic, so `from <= to` going in guarantees
 * `clamp(from) <= clamp(to)` coming out.
 */
function clampInto(date: string, bounds: Bounds): string {
  if (bounds.start && date < bounds.start) return bounds.start
  if (bounds.end && date > bounds.end) return bounds.end
  return date
}

/**
 * Whole days `d` may shift by without leaving `bounds`, in either direction.
 * Used for a whole-bar move, which must preserve length rather than clamping
 * each endpoint independently: shifting is a single scalar, so the drag simply
 * stops dead at whichever boundary it reaches first.
 */
function clampShift(d: PlannerDeliverable, bounds: Bounds, days: number): number {
  const minDays = bounds.start ? diffDays(d.start, bounds.start) : -Infinity
  const maxDays = bounds.end ? diffDays(d.end, bounds.end) : Infinity
  return Math.max(minDays, Math.min(maxDays, days))
}

function projectOf(model: PlannerModel, d: PlannerDeliverable): PlannerProject | undefined {
  return model.projects.find((p) => p.slug === d.project)
}

/**
 * The window `d` is kept inside when an overrun is declined: a work package's
 * parent deliverable's span, or a root deliverable's project `start:`/`end:`
 * dates (whichever sides the project declares). Always widened to take in
 * `d`'s own current span, so a bar that already sticks out is never yanked
 * back by an unrelated edit, only stopped from sticking out *further*.
 */
function boundsOf(model: PlannerModel, d: PlannerDeliverable): Bounds | null {
  const parent = d.parentId ? model.byId.get(d.parentId) : undefined
  if (parent) return { start: minDate(parent.start, d.start), end: maxDate(parent.end, d.end) }
  const project = projectOf(model, d)
  if (!project || (!project.startDate && !project.dueDate)) return null
  return {
    start: project.startDate ? minDate(project.startDate, d.start) : null,
    end: project.dueDate ? maxDate(project.dueDate, d.end) : null
  }
}

/** A deliverable regrown to a new span so a child fits inside it. */
interface ParentGrowth {
  deliverable: PlannerDeliverable
  start: string
  end: string
}

/** What would have to grow for `d` to take a span past its parent's. */
export interface Overrun {
  /**
   * The deliverables regrown to cover it, innermost first: a work package's
   * deliverable, or — for a 🏁 milestone — the deliverable it sits under and,
   * when that's a work package, its deliverable too.
   */
  parents: ParentGrowth[]
  /**
   * The project whose dates the (root) deliverable now runs past: the new
   * `start:` and/or `end:` to write, null for a side that stays as it is.
   */
  project: { project: PlannerProject; start: string | null; end: string | null } | null
}

/**
 * Whether giving `d` the span `start`→`end` would run it past its parent's —
 * and if so, the extension that would cover it. A work package that grows its
 * deliverable can in turn push that deliverable past the project's dates, so
 * both come back together and the user is asked once. Null when nothing
 * overruns (including when `d` merely stays as far out as it already was).
 */
export function planOverrun(
  model: PlannerModel,
  d: PlannerDeliverable,
  start: string,
  end: string
): Overrun | null {
  let parentPlan: ParentGrowth | null = null
  let root = d
  let rootStart = start
  let rootEnd = end
  const parent = d.parentId ? model.byId.get(d.parentId) : undefined
  if (parent) {
    const bounds = boundsOf(model, d)!
    if (start < bounds.start! || end > bounds.end!) {
      parentPlan = {
        deliverable: parent,
        start: minDate(parent.start, start),
        end: maxDate(parent.end, end)
      }
    }
    root = parent
    rootStart = parentPlan?.start ?? parent.start
    rootEnd = parentPlan?.end ?? parent.end
  }
  // The same widened bound `boundsOf` gives a root deliverable.
  const project = projectOf(model, root)
  const projectBounds = boundsOf(model, root)
  const newStart = projectBounds?.start && rootStart < projectBounds.start ? rootStart : null
  const newEnd = projectBounds?.end && rootEnd > projectBounds.end ? rootEnd : null
  const projectPlan =
    project && (newStart || newEnd) ? { project, start: newStart, end: newEnd } : null
  return parentPlan || projectPlan
    ? { parents: parentPlan ? [parentPlan] : [], project: projectPlan }
    : null
}

/** `Sep 6`, or `Sep 6, 2027` outside the current year. */
function shortDate(date: string, thisYear: number): string {
  const d = dayjs(date)
  return d.format(d.year() === thisYear ? 'MMM D' : 'MMM D, YYYY')
}

const shortSpan = (start: string, end: string, thisYear: number): string =>
  `${shortDate(start, thisYear)} – ${shortDate(end, thisYear)}`

/** How a span runs past a window: `start before`, `end after`, or `run outside` it. */
function overrunWhere(before: boolean, after: boolean): string {
  return before && after ? 'run outside' : before ? 'start before' : 'end after'
}

/** The before → after rows for a project's moved `start:`/`end:`. */
function projectChanges(plan: NonNullable<Overrun['project']>, thisYear: number): ConfirmChange[] {
  const { project, start, end } = plan
  const changes: ConfirmChange[] = []
  if (start)
    changes.push({
      label: `${project.title} (project start)`,
      from: shortDate(project.startDate!, thisYear),
      to: shortDate(start, thisYear)
    })
  if (end)
    changes.push({
      label: `${project.title} (project end)`,
      from: shortDate(project.dueDate!, thisYear),
      to: shortDate(end, thisYear)
    })
  return changes
}

/** The question put to the user about an overrun: a title, one sentence, and what would change. */
export function overrunPrompt(
  d: { label: string },
  overrun: Overrun,
  /** Dates in this year drop the year — injectable so tests don't age. */
  thisYear: number = dayjs().year()
): { title: string; message: string; changes: ConfirmChange[] } {
  const { parents, project } = overrun
  const projectWhere = project ? overrunWhere(!!project.start, !!project.end) : ''
  if (parents.length > 0) {
    const whereOf = ({ deliverable: p, start, end }: ParentGrowth): string =>
      overrunWhere(start < p.start, end > p.end)
    const [first, ...outer] = parents
    const thens = [
      ...outer.map((g) => `${whereOf(g)} its deliverable`),
      ...(project ? [`${projectWhere} its project`] : [])
    ]
    return {
      title: `Extend “${first.deliverable.label}”?`,
      message: `“${d.label}” would ${whereOf(first)} the deliverable it belongs to${thens.map((t) => `, which would then ${t}`).join('')}.`,
      changes: [
        ...parents.map(({ deliverable: p, start, end }) => ({
          label: p.label,
          from: shortSpan(p.start, p.end, thisYear),
          to: shortSpan(start, end, thisYear)
        })),
        ...(project ? projectChanges(project, thisYear) : [])
      ]
    }
  }
  const plan = project!
  const which = plan.start && plan.end ? 'dates' : plan.start ? 'start date' : 'end date'
  return {
    title: `Move “${plan.project.title}”'s ${which}?`,
    message: `“${d.label}” would ${projectWhere} the project's ${plan.start && plan.end ? 'dates' : which}.`,
    changes: projectChanges(plan, thisYear)
  }
}

/**
 * Ask about an overrun, if there is one. Returns the extension to make when
 * the user accepts it; null when there was nothing to ask, or they declined —
 * either way the caller then clamps into `boundsOf`, which is a no-op when
 * nothing overran.
 */
async function askToExtend(
  model: PlannerModel,
  d: PlannerDeliverable,
  start: string,
  end: string
): Promise<Overrun | null> {
  return confirmOverrun(d, planOverrun(model, d, start, end))
}

async function confirmOverrun(
  d: { label: string },
  overrun: Overrun | null
): Promise<Overrun | null> {
  if (!overrun) return null
  const { title, message, changes } = overrunPrompt(d, overrun)
  const project = overrun.project
  const which = project?.start && project.end ? 'dates' : project?.start ? 'start date' : 'end date'
  const ok = await confirm(message, {
    title,
    changes,
    primary: true,
    okLabel: overrun.parents.length > 0 ? 'Extend' : `Move ${which}`,
    cancelLabel:
      overrun.parents.length > 0
        ? 'Keep inside'
        : which === 'dates'
          ? 'Keep inside'
          : `Stop at ${which}`
  })
  return ok ? overrun : null
}

/** Every span a resize of `d` to `from`→`to` writes: its own, plus the downstream cascade. */
function addResizeSpans(
  spans: Map<string, PlannedSpan>,
  model: PlannerModel,
  d: PlannerDeliverable,
  from: string,
  to: string
): void {
  spans.set(d.id, { start: from, end: to })
  const days = diffDays(d.end, to)
  if (days === 0) return
  for (const id of cascadeShift(model, d.id, days, false)) {
    const dep = model.byId.get(id)
    if (dep && id !== d.id && !spans.has(id))
      spans.set(id, { start: addDays(dep.start, days), end: addDays(dep.end, days) })
  }
}

/** Preview spans for every deliverable an accepted overrun regrows. */
function addParentSpans(
  spans: Map<string, PlannedSpan>,
  model: PlannerModel,
  overrun: Overrun | null
): void {
  for (const { deliverable, start, end } of overrun?.parents ?? [])
    addResizeSpans(spans, model, deliverable, start, end)
}

/**
 * Write the parent half of an accepted overrun — before the child's own
 * write, so the bar it's growing to cover is there first, and outermost
 * first for the same reason. Through `writeSpan`, so a deliverable whose end
 * grows carries its own dependents along exactly as a hand resize would.
 */
async function extendParent(model: PlannerModel, overrun: Overrun): Promise<boolean> {
  for (const { deliverable, start, end } of [...overrun.parents].reverse())
    if (!(await writeSpan(model, deliverable, start, end))) return false
  return true
}

/**
 * The project half — always **last**: `setFrontmatter` rewrites the whole
 * YAML block, which can change the note's line count and so invalidate every
 * line number the line-anchored writes before it were holding.
 */
async function extendProject(overrun: Overrun): Promise<void> {
  if (!overrun.project) return
  const { project, start, end } = overrun.project
  await setProjectDates(project.path, project.frontmatter, {
    ...(start ? { start } : {}),
    ...(end ? { end } : {})
  })
}

/**
 * Move a deliverable by `days`, taking everything that depends on it along.
 * When that would run it past its parent — a work package past its
 * deliverable, a deliverable past its project's `end:` — the user is asked
 * whether to extend the parent to fit; declined, `days` is clamped so the drag
 * simply stops at whichever edge it reaches.
 *
 * The writes go out **serially** — `verifiedEdit` re-reads the note per call,
 * so two concurrent writes into one note would make the second stale — in
 * dependency order. Each is a single-line replace, which never changes a note's
 * line count, so every other cached line number in the batch stays valid
 * throughout.
 *
 * On a refusal partway through we stop and say how far we got rather than
 * rolling back: everything already written is valid, and rollback writes could
 * themselves go stale while racing the incoming index deltas.
 */
export async function moveDeliverable(
  model: PlannerModel,
  id: string,
  days: number,
  onPlan?: OnPlan
): Promise<void> {
  const dragged = model.byId.get(id)
  if (!dragged || days === 0) return
  const extend = await askToExtend(
    model,
    dragged,
    addDays(dragged.start, days),
    addDays(dragged.end, days)
  )
  const bounds = extend ? null : boundsOf(model, dragged)
  const shift = bounds ? clampShift(dragged, bounds, days) : days
  const spans = new Map<string, PlannedSpan>()
  addParentSpans(spans, model, extend)
  const order = shift === 0 ? [] : cascadeShift(model, id, shift)
  for (const currentId of order) {
    const d = model.byId.get(currentId)
    if (d) spans.set(d.id, { start: addDays(d.start, shift), end: addDays(d.end, shift) })
  }
  onPlan?.(spans, new Map())
  if (shift === 0) return
  if (extend && !(await extendParent(model, extend))) return
  let written = 0
  for (const currentId of order) {
    const d = model.byId.get(currentId)
    if (!d) continue
    const [start, end] = spanFor(d, addDays(d.start, shift), addDays(d.end, shift))
    const ok = await guarded(
      () => host.replaceLine(d.path, d.line, d.rawLine, setDeliverableDates(d.rawLine, start, end)),
      order.length === 1
        ? 'Note changed on disk — planner refreshed'
        : `${d.label} changed on disk — ${written} of ${order.length} moved; drag again to finish`
    )
    if (!ok) return
    written++
  }
  if (extend) await extendProject(extend)
}

/**
 * Change one deliverable's span (an edge drag or a date-picker edit). Moving
 * the *end* later or earlier carries everything downstream along by the same
 * number of days — exactly what `moveDeliverable` does for a whole-bar drag —
 * since a dependent's whole reason for waiting is that end date. Moving the
 * *start* never touches dependents: nothing downstream cares when this one
 * began, only when it finishes.
 *
 * When the new span runs past its parent's, the user is asked whether to
 * extend the parent to fit. Declined, each endpoint is separately clamped into
 * the parent's window — unlike `moveDeliverable`'s shift, a resize is already
 * changing the length, so clamping the far-out endpoint back to the boundary
 * (rather than refusing the whole edit) is the expected "stop at the edge" feel.
 *
 * Shrinking `d` fits whatever it holds back inside it (`planShrink`): work
 * packages slide in, diamonds stop at the new edge, and anything too long to
 * slide is trimmed — after a warning, whose Cancel abandons the whole resize.
 */
export async function resizeDeliverable(
  model: PlannerModel,
  d: PlannerDeliverable,
  start: string,
  end: string,
  onPlan?: OnPlan
): Promise<void> {
  let [from, to] = spanFor(d, start, end)
  const extend = await askToExtend(model, d, from, to)
  const bounds = extend ? null : boundsOf(model, d)
  if (bounds) {
    from = clampInto(from, bounds)
    to = clampInto(to, bounds)
  }
  const changed = from !== d.start || to !== d.end
  const reflow = changed
    ? planShrink(
        { kind: 'deliverable', deliverable: d },
        { start: d.start, end: d.end },
        { start: from, end: to }
      )
    : EMPTY_REFLOW
  if (!(await confirmTrim(reflow))) {
    onPlan?.(new Map(), new Map())
    return
  }
  const spans = new Map<string, PlannedSpan>()
  addParentSpans(spans, model, extend)
  if (changed) addResizeSpans(spans, model, d, from, to)
  addReflowSpans(spans, reflow)
  onPlan?.(spans, reflowPoints(reflow))
  if (!changed) return
  if (extend && !(await extendParent(model, extend))) return
  if (!(await writeSpan(model, d, from, to))) return
  if (!(await writeLines(reflowEdits(reflow), 'fitted'))) return
  if (extend) await extendProject(extend)
}

/**
 * Write `d`'s new span as given — no bounds check — and carry its dependents
 * along when the end moved. False when a write was refused as stale.
 */
async function writeSpan(
  model: PlannerModel,
  d: PlannerDeliverable,
  from: string,
  to: string
): Promise<boolean> {
  const ok = await guarded(
    () => host.replaceLine(d.path, d.line, d.rawLine, setDeliverableDates(d.rawLine, from, to)),
    'Note changed on disk — planner refreshed'
  )
  if (!ok) return false
  const days = diffDays(d.end, to)
  if (days === 0) return true
  const order = cascadeShift(model, d.id, days, false).filter((id) => id !== d.id)
  let written = 0
  for (const currentId of order) {
    const dep = model.byId.get(currentId)
    if (!dep) continue
    const [depFrom, depTo] = spanFor(dep, addDays(dep.start, days), addDays(dep.end, days))
    const depOk = await guarded(
      () =>
        host.replaceLine(
          dep.path,
          dep.line,
          dep.rawLine,
          setDeliverableDates(dep.rawLine, depFrom, depTo)
        ),
      `${dep.label} changed on disk — ${written} of ${order.length} moved; drag again to finish`
    )
    if (!depOk) return false
    written++
  }
  return true
}

// ---------- Shrinking a parent ----------

/** Whose window shrank: a project's `start:`/`end:`, or a deliverable's span. */
export type ShrinkParent =
  | { kind: 'project'; project: PlannerProject }
  | { kind: 'deliverable'; deliverable: PlannerDeliverable }

/** A diamond (🏁 milestone, or a task's 📅) a plan re-dates. */
export interface DatedRef {
  path: string
  line: number
  rawLine: string
  label: string
  date: string
}

/** Every child a shrink (or a project move) re-dates, outermost first. */
export interface Reflow {
  spans: { deliverable: PlannerDeliverable; start: string; end: string; trimmed: boolean }[]
  points: { ref: DatedRef; to: string }[]
}

const EMPTY_REFLOW: Reflow = { spans: [], points: [] }

const milestoneRef = (m: PlannerProject['milestones'][number]): DatedRef => ({
  ...m,
  label: m.text
})

/** The bars and diamonds drawn directly under `parent`. */
function childrenOf(parent: ShrinkParent): { bars: PlannerDeliverable[]; points: DatedRef[] } {
  if (parent.kind === 'project')
    return {
      bars: parent.project.deliverables,
      points: parent.project.milestones.map(milestoneRef)
    }
  const d = parent.deliverable
  return {
    bars: d.workPackages,
    points: [
      ...d.milestones.map(milestoneRef),
      ...d.tasks.flatMap((t) => (t.due ? [{ ...t, label: t.text, date: t.due }] : []))
    ]
  }
}

/**
 * What `start`→`end` has to fit inside once its parent went from `before` to
 * `after`. Only a side that actually moved *inward* is enforced; any other
 * declared side is widened to take in where the child already is — the same
 * rule as `boundsOf`, so a bar that already stuck out on an untouched side is
 * never yanked back by this.
 */
function fitBounds(before: Bounds, after: Bounds, start: string, end: string): Bounds {
  const startShrank = !!after.start && (!before.start || after.start > before.start)
  const endShrank = !!after.end && (!before.end || after.end < before.end)
  return {
    start: after.start ? (startShrank ? after.start : minDate(after.start, start)) : null,
    end: after.end ? (endShrank ? after.end : maxDate(after.end, end)) : null
  }
}

/**
 * The days a span must slide to sit inside `bounds` keeping its length — 0
 * when it already does — or null when it's longer than `bounds` and can only
 * fit by being trimmed.
 */
function slideInto(start: string, end: string, bounds: Bounds): number | null {
  if (bounds.start && bounds.end && diffDays(start, end) > diffDays(bounds.start, bounds.end))
    return null
  if (bounds.end && end > bounds.end) return diffDays(end, bounds.end)
  if (bounds.start && start < bounds.start) return diffDays(start, bounds.start)
  return 0
}

/**
 * Fit everything under `parent` back inside it after its window went from
 * `before` to `after` — what shrinking a project or a deliverable does to
 * its children. A bar slides in, keeping its length, carrying everything it
 * holds along by the same days, exactly like a whole-bar move would; one too
 * long for the new window is trimmed to fill it instead (`trimmed`, which the
 * caller must warn about), and its own children are then fitted to the
 * trimmed span in turn. Diamonds stop at the edge.
 *
 * Dependencies are deliberately *not* cascaded: sliding a dependent later
 * would just push it back out of a window that has only got smaller. Any
 * order this breaks shows up as the usual `violated` highlight.
 */
export function planShrink(parent: ShrinkParent, before: Bounds, after: Bounds): Reflow {
  const reflow: Reflow = { spans: [], points: [] }
  fit(parent, before, after, reflow)
  return reflow
}

function fit(parent: ShrinkParent, before: Bounds, after: Bounds, reflow: Reflow): void {
  const { bars, points } = childrenOf(parent)
  for (const ref of points) {
    const to = clampInto(ref.date, fitBounds(before, after, ref.date, ref.date))
    if (to !== ref.date) reflow.points.push({ ref, to })
  }
  for (const d of bars) {
    const bounds = fitBounds(before, after, d.start, d.end)
    const days = slideInto(d.start, d.end, bounds)
    if (days === 0) continue
    if (days !== null) {
      reflow.spans.push({
        deliverable: d,
        start: addDays(d.start, days),
        end: addDays(d.end, days),
        trimmed: false
      })
      carry(d, days, reflow)
      continue
    }
    // Slid as far in as it goes and the overhang cut off: exactly the window
    // (both sides are set — an open side always leaves room to slide).
    const start = bounds.start!
    const end = bounds.end!
    reflow.spans.push({ deliverable: d, start, end, trimmed: true })
    fit(
      { kind: 'deliverable', deliverable: d },
      { start: d.start, end: d.end },
      { start, end },
      reflow
    )
  }
}

/** Everything `d` holds, shifted by `days` along with it. */
function carry(d: PlannerDeliverable, days: number, reflow: Reflow): void {
  const { bars, points } = childrenOf({ kind: 'deliverable', deliverable: d })
  for (const ref of points) reflow.points.push({ ref, to: addDays(ref.date, days) })
  for (const wp of bars) {
    reflow.spans.push({
      deliverable: wp,
      start: addDays(wp.start, days),
      end: addDays(wp.end, days),
      trimmed: false
    })
    carry(wp, days, reflow)
  }
}

function addReflowSpans(spans: Map<string, PlannedSpan>, reflow: Reflow): void {
  for (const { deliverable, start, end } of reflow.spans)
    if (!spans.has(deliverable.id)) spans.set(deliverable.id, { start, end })
}

function reflowPoints(reflow: Reflow): Map<string, string> {
  return new Map(reflow.points.map(({ ref, to }) => [lineKey(ref), to]))
}

/** The before → after rows of a trim warning, and its wording. */
export function trimPrompt(
  reflow: Reflow,
  /** Dates in this year drop the year — injectable so tests don't age. */
  thisYear: number = dayjs().year()
): { title: string; message: string; changes: ConfirmChange[] } | null {
  const trimmed = reflow.spans.filter((s) => s.trimmed)
  if (trimmed.length === 0) return null
  const one = trimmed.length === 1
  return {
    title: one ? `Shorten “${trimmed[0].deliverable.label}”?` : `Shorten ${trimmed.length} bars?`,
    message: `${
      one ? `“${trimmed[0].deliverable.label}” is` : `${trimmed.length} bars are`
    } longer than the new window, so ${one ? 'it' : 'they'} would be shortened to fit. Anything else outside it slides in, keeping its length.`,
    changes: trimmed.map(({ deliverable: d, start, end }) => ({
      label: d.label,
      from: shortSpan(d.start, d.end, thisYear),
      to: shortSpan(start, end, thisYear)
    }))
  }
}

/** Warn before a plan trims anything. False when the user backs out. */
async function confirmTrim(reflow: Reflow): Promise<boolean> {
  const prompt = trimPrompt(reflow)
  if (!prompt) return true
  return confirm(prompt.message, {
    title: prompt.title,
    changes: prompt.changes,
    primary: true,
    okLabel: 'Shorten',
    cancelLabel: 'Cancel'
  })
}

/** One verified single-line rewrite in a batch. */
interface LineEdit {
  path: string
  line: number
  rawLine: string
  newLine: string
  label: string
}

function reflowEdits(reflow: Reflow): LineEdit[] {
  return [
    ...reflow.spans.map(({ deliverable: d, start, end }) => ({
      path: d.path,
      line: d.line,
      rawLine: d.rawLine,
      newLine: setDeliverableDates(d.rawLine, start, end),
      label: d.label
    })),
    ...reflow.points.map(({ ref, to }) => ({
      path: ref.path,
      line: ref.line,
      rawLine: ref.rawLine,
      newLine: withDate(ref.rawLine, to),
      label: ref.label
    }))
  ]
}

/**
 * Write a batch of single-line rewrites, serially — `verifiedEdit` re-reads
 * the note per call, so concurrent writes into one note would go stale — and
 * none of them changes a line count, so every cached line number stays valid.
 * A refusal stops the batch and says how far it got. False when it stopped.
 */
async function writeLines(edits: LineEdit[], verb: string): Promise<boolean> {
  let written = 0
  for (const e of edits) {
    if (e.newLine === e.rawLine) {
      written++
      continue
    }
    const ok = await guarded(
      () => host.replaceLine(e.path, e.line, e.rawLine, e.newLine),
      edits.length === 1
        ? 'Note changed on disk — planner refreshed'
        : `${e.label} changed on disk — ${written} of ${edits.length} ${verb}; try again to finish`
    )
    if (!ok) return false
    written++
  }
  return true
}

/**
 * Set a project's `start:`/`end:` (a date sets that side, null clears it,
 * undefined leaves it), first fitting everything inside it to a window that
 * got smaller — see `planShrink`; a trim is warned about, and Cancel writes
 * nothing. The children go first and the frontmatter **last**: its rewrite can
 * change the note's line count, which would strand every line number the
 * children's writes were holding. `onPlan` hears the children's new dates
 * before the first write. False when nothing was written.
 */
export async function editProjectDates(
  project: PlannerProject,
  dates: { start?: string | null; end?: string | null },
  onPlan?: OnPlan
): Promise<boolean> {
  const { reflow } = planProjectDates(project, dates)
  if (!(await confirmTrim(reflow))) {
    onPlan?.(new Map(), new Map())
    return false
  }
  const preview = reflowPreview(reflow)
  onPlan?.(preview.spans, preview.points)
  if (!(await writeLines(reflowEdits(reflow), 'fitted'))) return false
  await setProjectDates(project.path, project.frontmatter, dates)
  return true
}

/**
 * Drag a whole project by `days`: every deliverable and work package in it,
 * every deliverable elsewhere that depends on one of them (the same cascade a
 * deliverable move takes along), every 🏁 milestone — the project's own and
 * its deliverables' — and every dated task that belongs to one of its
 * deliverables, then the declared side(s) of its `start:`/`end:`, **last**. A
 * side the project never declared is drawn from its deliverables, so it
 * follows them without being written.
 */
export async function moveProject(
  model: PlannerModel,
  project: PlannerProject,
  days: number,
  onPlan?: OnPlan
): Promise<void> {
  if (days === 0) return
  const plan = planProjectMove(model, project, days)
  onPlan?.(plan.spans, plan.points)
  if (!(await writeLines(plan.edits, 'moved'))) return
  if (!project.startDate && !project.dueDate) return
  await setProjectDates(project.path, project.frontmatter, {
    ...(project.startDate ? { start: addDays(project.startDate, days) } : {}),
    ...(project.dueDate ? { end: addDays(project.dueDate, days) } : {})
  })
}

/**
 * The line writes behind `moveProject` and the dates they give each bar and
 * diamond — pure, so the chart can draw a project drag in flight from it.
 * Each line is written once even when several paths reach it (a dependent of
 * two of the project's deliverables, say).
 */
export function planProjectMove(
  model: PlannerModel,
  project: PlannerProject,
  days: number
): { edits: LineEdit[]; spans: Map<string, PlannedSpan>; points: Map<string, string> } {
  const own = [...model.byId.values()].filter((d) => d.project === project.slug)
  const seen = new Set<string>()
  const edits: LineEdit[] = []
  const spans = new Map<string, PlannedSpan>()
  const points = new Map<string, string>()
  const add = (
    ref: { path: string; line: number; rawLine: string; label: string },
    newLine: string
  ): boolean => {
    const key = lineKey(ref)
    if (seen.has(key)) return false
    seen.add(key)
    edits.push({ path: ref.path, line: ref.line, rawLine: ref.rawLine, label: ref.label, newLine })
    return true
  }
  if (days === 0) return { edits, spans, points }
  for (const root of own)
    for (const id of cascadeShift(model, root.id, days)) {
      const d = model.byId.get(id)
      if (!d) continue
      const start = addDays(d.start, days)
      const end = addDays(d.end, days)
      if (add(d, setDeliverableDates(d.rawLine, start, end))) spans.set(d.id, { start, end })
    }
  const dated = [
    ...project.milestones.map(milestoneRef),
    ...own.flatMap((d) => childrenOf({ kind: 'deliverable', deliverable: d }).points)
  ]
  for (const ref of dated) {
    const to = addDays(ref.date, days)
    if (add(ref, withDate(ref.rawLine, to))) points.set(lineKey(ref), to)
  }
  return { edits, spans, points }
}

/**
 * The one side of a project's dates an edge drag of `days` sets, from where
 * its window is drawn now (`projectWindow` — an undeclared side included, so
 * dragging it declares it). Never crosses the other side.
 */
export function projectEdgeDates(
  project: PlannerProject,
  edge: 'start' | 'end',
  days: number
): { start?: string; end?: string } | null {
  const w = projectWindow(project)
  if (!w) return null
  return edge === 'start'
    ? { start: minDate(addDays(w.start, days), w.end) }
    : { end: maxDate(addDays(w.end, days), w.start) }
}

/** The fit an edit of a project's dates would make — `editProjectDates`' plan, pure for previews. */
export function planProjectDates(
  project: PlannerProject,
  dates: { start?: string | null; end?: string | null }
): { after: Bounds; reflow: Reflow } {
  const after = {
    start: dates.start === undefined ? project.startDate : dates.start,
    end: dates.end === undefined ? project.dueDate : dates.end
  }
  return {
    after,
    reflow: planShrink(
      { kind: 'project', project },
      { start: project.startDate, end: project.dueDate },
      after
    )
  }
}

/** A plan's bars and diamonds as the maps the chart draws a preview from. */
export function reflowPreview(reflow: Reflow): {
  spans: Map<string, PlannedSpan>
  points: Map<string, string>
} {
  const spans = new Map<string, PlannedSpan>()
  addReflowSpans(spans, reflow)
  return { spans, points: reflowPoints(reflow) }
}

/** Record that `dependent` waits on `predecessor`. Caller has already ruled out a cycle. */
export async function linkDependency(
  dependent: PlannerDeliverable,
  predecessorId: string
): Promise<void> {
  const newLine = addDependency(dependent.rawLine, predecessorId)
  if (newLine === dependent.rawLine) return
  await guarded(
    () => host.replaceLine(dependent.path, dependent.line, dependent.rawLine, newLine),
    'Note changed on disk — planner refreshed'
  )
}

export async function unlinkDependency(
  dependent: PlannerDeliverable,
  predecessorId: string
): Promise<void> {
  const newLine = removeDependency(dependent.rawLine, predecessorId)
  if (newLine === dependent.rawLine) return
  await guarded(
    () => host.replaceLine(dependent.path, dependent.line, dependent.rawLine, newLine),
    'Note changed on disk — planner refreshed'
  )
}

/** Set (or, with null, clear back to inherited) a deliverable's own bar color. */
export async function setDeliverableColor(
  d: PlannerDeliverable,
  color: PlannerColor | null
): Promise<void> {
  const newLine = setColorMarker(d.rawLine, color)
  if (newLine === d.rawLine) return
  await guarded(
    () => host.replaceLine(d.path, d.line, d.rawLine, newLine),
    'Note changed on disk — planner refreshed'
  )
}

/** Set (or, with null, clear back to the default) a project's bar color. */
export async function setProjectColor(
  path: string,
  frontmatter: Record<string, unknown>,
  color: PlannerColor | null
): Promise<void> {
  const next = { ...frontmatter }
  if (color) next[PROJECT_COLOR_KEY] = color
  else delete next[PROJECT_COLOR_KEY]
  await host.setFrontmatter(path, next)
}

// ---------- Creation ----------

/** The starter content of a new project note. */
export function projectNoteTemplate(title: string, slug: string, end?: string | null): string {
  return [
    '---',
    'type: project',
    `project: ${slug}`,
    ...(end ? [`${PROJECT_END_KEY}: ${end}`] : []),
    '---',
    '',
    `# ${title}`,
    '',
    '## Deliverables',
    '',
    ''
  ].join('\n')
}

/**
 * Create a project note and return where it landed — the host uniquifies the
 * filename, so this never overwrites an existing note.
 */
export async function createProject(
  title: string,
  folder: string,
  end?: string | null
): Promise<string> {
  const slug = slugify(title)
  const path = folder ? `${folder.replace(/\/+$/, '')}/${title}.md` : `${title}.md`
  const created = await host.createNote(path, projectNoteTemplate(title, slug, end))
  await host.openNote(created)
  return created
}

/**
 * Open or close a project. Closing stamps `status: completed`; reopening
 * removes the key rather than writing `status: active`, so a project that was
 * never closed and one that was reopened read identically.
 *
 * Goes through `setFrontmatter`, which rewrites the whole YAML block — the one
 * place a frontmatter edit is safe, since a targeted line rewrite can't add a
 * key that isn't there yet.
 */
export async function setProjectComplete(
  path: string,
  frontmatter: Record<string, unknown>,
  complete: boolean
): Promise<void> {
  const next = { ...frontmatter }
  if (complete) next[PROJECT_STATUS_KEY] = 'completed'
  else delete next[PROJECT_STATUS_KEY]
  await host.setFrontmatter(path, next)
}

/**
 * Set a project's `start:` and/or `end:` in one frontmatter rewrite: a date
 * sets that side, null clears it, undefined leaves it alone. Writing `end:`
 * also drops the `due:`/`deadline:` aliases `projectEndDate` reads, so a
 * cleared end can't quietly fall back to a stale alias.
 */
export async function setProjectDates(
  path: string,
  frontmatter: Record<string, unknown>,
  dates: { start?: string | null; end?: string | null }
): Promise<void> {
  const next = { ...frontmatter }
  if (dates.start !== undefined) {
    if (dates.start) next[PROJECT_START_KEY] = dates.start
    else delete next[PROJECT_START_KEY]
  }
  if (dates.end !== undefined) {
    delete next['due']
    delete next['deadline']
    if (dates.end) next[PROJECT_END_KEY] = dates.end
    else delete next[PROJECT_END_KEY]
  }
  await host.setFrontmatter(path, next)
}

/** The deliverable line for a new deliverable, and the tag it claims. */
export function deliverableLine(
  projectSlugValue: string,
  name: string,
  start: string,
  end: string
): { line: string; tag: string } {
  const tag = `deliverable/${projectSlugValue}/${slugify(name)}`
  // `@task`, because only a task line can *define* a deliverable — see
  // `claimableDeliverableTag`. Without the marker the new deliverable would
  // never be elected and the bar would never appear on the chart.
  return {
    line: `- [ ] ${TASK_MARKER} ${name} 🛫 ${start} 📅 ${end} ${deliverableRefMarker(tag)}`,
    tag
  }
}

export async function addDeliverable(
  projectPath: string,
  projectSlugValue: string,
  name: string,
  start: string,
  end: string
): Promise<void> {
  const { line } = deliverableLine(projectSlugValue, name, start, end)
  await host.appendToNote(projectPath, line)
}

/**
 * The work-package line for a new deliverable nested under `parent`, and the
 * tag it claims. `start`/`end` are clamped into `parent`'s own window — a
 * work package can never extend before or after the deliverable it belongs
 * to, from the moment it's created onward.
 */
export function workPackageLine(
  parent: PlannerDeliverable,
  name: string,
  start: string,
  end: string
): { line: string; tag: string } {
  const parentName = parseDeliverableTag(parent.id)!.deliverable
  const tag = `deliverable/${parent.project}/${slugify(name)}`
  const clampedStart = clampInto(start, parent)
  const clampedEnd = clampInto(end, parent)
  return {
    line: `${taskChildIndent(parent.rawLine)}- [ ] ${TASK_MARKER} ${name} 🛫 ${clampedStart} 📅 ${clampedEnd} ${deliverableRefMarker(tag)} @parent(${parentName})`,
    tag
  }
}

/**
 * Add a work package under `parent` — a deliverable nested one level inside
 * it, timeboxing a chunk of its work. Placed right after the parent's own
 * line and indented one level deeper, same as `addTask` below. Nesting is
 * capped at one level (`deliverableDefinitions`), so `parent` itself must be
 * a root deliverable — the caller only offers this action on a root's row,
 * never on a work package's.
 */
export async function addWorkPackage(
  parent: PlannerDeliverable,
  name: string,
  start: string,
  end: string
): Promise<void> {
  const { line } = workPackageLine(parent, name, start, end)
  await guarded(
    () => host.insertLine(parent.path, parent.line, parent.rawLine, line),
    'Deliverable changed on disk — planner refreshed'
  )
}

/**
 * Add a task under its deliverable. Anchored on the deliverable's own line —
 * whose exact text we hold — so it's one verified call with no read-then-write
 * race, and the task lands inside the deliverable's own block.
 *
 * Deliberately a plain checkbox, with no `@task`: this is a *member* of the
 * deliverable (it counts toward progress and shows on the chart), not a Kanban
 * card of its own. It used to be hard-indented four spaces to force that,
 * back when indentation was what decided; now the marker decides, so the
 * indent is free to follow the deliverable's own nesting instead.
 */
export async function addTask(d: PlannerDeliverable, text: string): Promise<void> {
  const line = `${taskChildIndent(d.rawLine)}- [ ] ${text} ${deliverableRefMarker(d.id)}`
  await guarded(
    () => host.insertLine(d.path, d.line, d.rawLine, line),
    `${d.parentId ? 'Work package' : 'Deliverable'} changed on disk — planner refreshed`
  )
}

export async function addMilestone(
  d: PlannerDeliverable,
  text: string,
  date: string
): Promise<void> {
  await guarded(
    () =>
      host.insertLine(
        d.path,
        d.line,
        d.rawLine,
        `🏁 ${text} 📅 ${date} ${deliverableRefMarker(d.id)}`
      ),
    `${d.parentId ? 'Work package' : 'Deliverable'} changed on disk — planner refreshed`
  )
}

/**
 * A dated line (🏁 milestone or a task's 📅) with its date swapped in place —
 * the marker keeps its spelling and position, so a drag never reshuffles the
 * line. A line with no date yet gets a trailing `📅`.
 */
export function withDate(rawLine: string, date: string): string {
  if (!DUE_RE.test(rawLine)) return setDueDate(rawLine, date)
  return rawLine.replace(DUE_RE, (m) => m.replace(/\d{4}-\d{2}-\d{2}/, date))
}

/**
 * What a dated diamond (a 🏁 milestone, or a task's 📅) has to stay inside:
 * the deliverable it's drawn under, or — for a milestone pinned to the
 * project row — the project's `start:`/`end:`.
 */
export type PointOwner =
  | { kind: 'deliverable'; deliverable: PlannerDeliverable }
  | { kind: 'project'; project: PlannerProject }

/** `boundsOf` for a diamond: its owner's window, widened to take in where it already is. */
function pointBoundsOf(owner: PointOwner, current: string): Bounds | null {
  if (owner.kind === 'deliverable') {
    const d = owner.deliverable
    return { start: minDate(d.start, current), end: maxDate(d.end, current) }
  }
  const { project } = owner
  if (!project.startDate && !project.dueDate) return null
  return {
    start: project.startDate ? minDate(project.startDate, current) : null,
    end: project.dueDate ? maxDate(project.dueDate, current) : null
  }
}

/**
 * Whether re-dating a diamond from `current` to `date` would put it outside
 * its owner — and if so, what would grow to cover it. Under a deliverable
 * that's the deliverable's span, which may in turn run past *its* parent
 * (`planOverrun` takes the rest of the chain); on the project row, the
 * project's dates. Null when it fits, or merely stays as far out as it was.
 */
export function planPointOverrun(
  model: PlannerModel,
  owner: PointOwner,
  current: string,
  date: string
): Overrun | null {
  const bounds = pointBoundsOf(owner, current)
  if (!bounds || clampInto(date, bounds) === date) return null
  if (owner.kind === 'project') {
    return {
      parents: [],
      project: {
        project: owner.project,
        start: bounds.start && date < bounds.start ? date : null,
        end: bounds.end && date > bounds.end ? date : null
      }
    }
  }
  const d = owner.deliverable
  const growth = { deliverable: d, start: minDate(d.start, date), end: maxDate(d.end, date) }
  const outer = planOverrun(model, d, growth.start, growth.end)
  return { parents: [growth, ...(outer?.parents ?? [])], project: outer?.project ?? null }
}

/**
 * Move a 🏁 milestone (or a dated task's diamond) by `days`. Same rules as a
 * bar: past its owner, the user is asked whether to extend the owner (and
 * whatever that in turn runs past) to fit; declined, the date stops at the
 * owner's edge. `onPlan` hears the date that will be written and every bar
 * an accepted extension regrows, before the first write.
 */
export async function moveDatedLine(
  model: PlannerModel,
  owner: PointOwner | null,
  item: { path: string; line: number; rawLine: string; label: string },
  date: string,
  days: number,
  onPlan?: (date: string, spans: Map<string, PlannedSpan>) => void
): Promise<boolean> {
  if (days === 0) return true
  let target = addDays(date, days)
  const extend = owner
    ? await confirmOverrun(item, planPointOverrun(model, owner, date, target))
    : null
  const bounds = owner && !extend ? pointBoundsOf(owner, date) : null
  if (bounds) target = clampInto(target, bounds)
  const spans = new Map<string, PlannedSpan>()
  addParentSpans(spans, model, extend)
  onPlan?.(target, spans)
  if (target === date) return true
  if (extend && !(await extendParent(model, extend))) return false
  const ok = await guarded(
    () => host.replaceLine(item.path, item.line, item.rawLine, withDate(item.rawLine, target)),
    'Note changed on disk — planner refreshed'
  )
  if (ok && extend) await extendProject(extend)
  return ok
}

/**
 * A milestone owned by the project itself rather than any deliverable: a 🏁
 * line in the project note naming no `@deliverable(...)`, which
 * `buildPlannerModel` pins to the project row.
 */
export function projectMilestoneLine(text: string, date: string): string {
  return `🏁 ${text} 📅 ${date}`
}

/**
 * Appended like `addDeliverable` — the line is unindented, so it can never
 * land inside a deliverable's owned block and get read as one of its members.
 */
export async function addProjectMilestone(
  projectPath: string,
  text: string,
  date: string
): Promise<void> {
  await host.appendToNote(projectPath, projectMilestoneLine(text, date))
}
