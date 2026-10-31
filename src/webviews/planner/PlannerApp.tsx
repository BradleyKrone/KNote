// The project planner: a Gantt chart over the vault's `type: project` notes.
//
// Everything on screen is derived from the index (buildPlannerModel) and every
// change is written straight back as a verified single-line edit, so the note
// stays the source of truth and an external edit reconciles by simply
// re-rendering from the next index delta.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarPlus,
  CalendarRange,
  CheckCircle2,
  CornerDownRight,
  Flag,
  Link2,
  ListPlus,
  Lock,
  Package,
  Palette,
  Plus,
  RotateCcw,
  Unlock
} from 'lucide-react'
import { host } from '../shared/rpc'
import { showToast, useConfigStore, useIndexStore } from '../shared/stores'
import { Popover } from '../shared/components/Popover'
import { ContextMenuList, type MenuEntry } from '../shared/components/ContextMenuList'
import { Bar, MilestoneMark, ProjectWindow } from './Bar'
import { CreateDialog, type CreateRequest, type CreateResult } from './CreateDialogs'
import { DependencyArrows, LinkPreview, type Span } from './DependencyArrows'
import { GridBody, GridHeader } from './TimeGrid'
import { ProjectDatesPicker } from './ProjectDatesPicker'
import { SpanPicker } from './SpanPicker'
import { TreePane } from './TreePane'
import { useBarDrag, type DragState } from './useBarDrag'
import {
  addDays,
  dateToX,
  domainOf,
  domainShiftPx,
  flattenRows,
  gridWidth,
  monthBands,
  rowIndexById,
  rowsHeight,
  rowTops,
  ROW_HEIGHT,
  moveInOrder,
  projectOrderKey,
  scopeOrderKeys,
  stableDomain,
  subBands,
  today as todayDate,
  type Domain,
  type PlannerRow,
  type Zoom,
  widenDomain
} from './plannerLayout'
import { PLANNER_COLORS, type PlannerColor } from '@shared/deliverables'
import {
  barColor,
  buildPlannerModel,
  cascadeShift,
  defaultProjectColor,
  deliverableBarStatus,
  inheritedBarColor,
  projectWindow,
  vaultFolders,
  violatedDependencies,
  wouldCycle,
  type PlannerDeliverable,
  type PlannerModel,
  type PlannerProject
} from './plannerSelectors'
import {
  addDeliverable,
  addMilestone,
  addProjectMilestone,
  addTask,
  addWorkPackage,
  createProject,
  editProjectDates,
  lineKey,
  linkDependency,
  moveDatedLine,
  moveDeliverable,
  moveProject,
  planProjectDates,
  planProjectMove,
  planShrink,
  projectEdgeDates,
  type PointOwner,
  reflowPreview,
  resizeDeliverable,
  setDeliverableColor,
  setProjectColor,
  setProjectComplete,
  unlinkDependency
} from './plannerActions'

const TREE_WIDTH = 260
const ZOOMS: Zoom[] = ['day', 'week', 'month']

/**
 * A project's dates as a drag (or a write still in flight) leaves them — laid
 * over the model's own when drawing its window.
 */
type ProjectDates = Pick<PlannerProject, 'startDate' | 'dueDate' | 'start' | 'end'>

/** A drag's committed dates take a moment to come back as an index delta; show them meanwhile. */
interface Pending {
  spans: Map<string, Span>
  /** Diamonds re-dated along with the bars, by `lineKey`. */
  points: Map<string, string>
  /** Project windows moved or resized, by slug. */
  projects: Map<string, ProjectDates>
  timer: number
}

/**
 * Everything a drag in flight changes besides what `spanFor` already shifts
 * itself: a project drag's bars, diamonds and window, or the children a
 * shrinking deliverable fits back inside it. Drawn live, and held on drop.
 */
interface DragPlan {
  spans: Map<string, Span>
  points: Map<string, string>
  project: { slug: string; dates: ProjectDates } | null
}

function planDrag(
  model: PlannerModel,
  projects: Map<string, PlannerProject>,
  drag: DragState | null
): DragPlan | null {
  if (!drag || drag.mode === 'link' || drag.deltaDays === 0) return null
  const days = drag.deltaDays
  const project = projects.get(drag.id)
  if (project) {
    if (drag.mode === 'move') {
      const { spans, points } = planProjectMove(model, project, days)
      const shift = (date: string | null): string | null => (date ? addDays(date, days) : null)
      return {
        spans,
        points,
        project: {
          slug: project.slug,
          dates: {
            startDate: shift(project.startDate),
            dueDate: shift(project.dueDate),
            start: shift(project.start),
            end: shift(project.end)
          }
        }
      }
    }
    const dates = projectEdgeDates(project, drag.mode === 'resize-start' ? 'start' : 'end', days)
    if (!dates) return null
    const { after, reflow } = planProjectDates(project, dates)
    return {
      ...reflowPreview(reflow),
      project: {
        slug: project.slug,
        dates: {
          startDate: after.start,
          dueDate: after.end,
          start: project.start,
          end: project.end
        }
      }
    }
  }
  const d = model.byId.get(drag.id)
  if (!d || drag.mode === 'move') return null
  const start = drag.mode === 'resize-end' ? d.start : addDays(d.start, days)
  const end = drag.mode === 'resize-start' ? d.end : addDays(d.end, days)
  const reflow = planShrink(
    { kind: 'deliverable', deliverable: d },
    { start: d.start, end: d.end },
    start <= end ? { start, end } : { start: end, end }
  )
  return { ...reflowPreview(reflow), project: null }
}

/** Every diamond's current date, by `lineKey` — what a pending re-date is checked against. */
function lineDates(model: PlannerModel): Map<string, string> {
  const dates = new Map<string, string>()
  for (const p of model.projects) for (const m of p.milestones) dates.set(lineKey(m), m.date)
  for (const d of model.byId.values()) {
    for (const m of d.milestones) dates.set(lineKey(m), m.date)
    for (const t of d.tasks) if (t.due) dates.set(lineKey(t), t.due)
  }
  return dates
}

const sameProjectDates = (p: PlannerProject, o: ProjectDates): boolean =>
  p.startDate === o.startDate && p.dueDate === o.dueDate

/**
 * A single-date diamond on the chart — a 🏁 milestone, or a task's 📅 — keyed
 * by its row key, which is also its drag id (`m:`/`t:` never collide with a
 * deliverable tag).
 */
interface DatedPoint {
  ref: { path: string; line: number; rawLine: string; label: string }
  date: string
  /** What it has to stay inside — the deliverable it's drawn under, else its project. */
  owner: PointOwner | null
}

function datedPoints(model: PlannerModel, rows: readonly PlannerRow[]): Map<string, DatedPoint> {
  const points = new Map<string, DatedPoint>()
  for (const row of rows) {
    if (row.kind === 'milestone') {
      const project = row.deliverable
        ? undefined
        : model.projects.find((p) => projectOrderKey(p) === row.parentKey)
      points.set(row.key, {
        ref: { ...row.milestone, label: row.milestone.text },
        date: row.milestone.date,
        owner: row.deliverable
          ? { kind: 'deliverable', deliverable: row.deliverable }
          : project
            ? { kind: 'project', project }
            : null
      })
    } else if (row.kind === 'task' && row.task.due)
      points.set(row.key, {
        ref: { ...row.task, label: row.task.text },
        date: row.task.due,
        owner: { kind: 'deliverable', deliverable: row.deliverable }
      })
  }
  return points
}

/**
 * Earliest start and latest end among the bars a drag is moving right now —
 * the dragged one plus, for a move or resize-end, everything cascading after
 * it — so the chart can grow to fit. Null when nothing is moving.
 */
function dragReachOf(
  model: PlannerModel,
  points: Map<string, DatedPoint>,
  drag: DragState | null,
  plan: DragPlan | null
): Span | null {
  if (!drag || drag.mode === 'link' || drag.deltaDays === 0) return null
  if (plan?.project) {
    const { dates } = plan.project
    const all = [
      ...[...plan.spans.values()].flatMap((s) => [s.start, s.end]),
      ...plan.points.values(),
      ...[dates.startDate, dates.dueDate, dates.start, dates.end].filter((x): x is string => !!x)
    ].sort()
    return all.length > 0 ? { start: all[0], end: all[all.length - 1] } : null
  }
  const point = points.get(drag.id)
  if (point) {
    const date = addDays(point.date, drag.deltaDays)
    return { start: date, end: date }
  }
  const d = model.byId.get(drag.id)
  if (!d) return null
  const delta = drag.deltaDays
  let start = drag.mode === 'resize-end' ? d.start : addDays(d.start, delta)
  let end = drag.mode === 'resize-start' ? d.end : addDays(d.end, delta)
  if (drag.mode !== 'resize-start') {
    for (const id of cascadeShift(model, drag.id, delta, drag.mode === 'move')) {
      const moved = id === drag.id ? undefined : model.byId.get(id)
      if (!moved) continue
      const s = addDays(moved.start, delta)
      const e = addDays(moved.end, delta)
      if (s < start) start = s
      if (e > end) end = e
    }
  }
  return start <= end ? { start, end } : { start: end, end: start }
}

export function PlannerApp(): React.JSX.Element {
  const notes = useIndexStore((s) => s.notes)
  const [zoom, setZoom] = useState<Zoom>('week')
  // Locked by default — a bare drag on a bar is too easy to trigger by
  // accident while scrolling or reading the chart. Unlocking is a deliberate
  // per-session choice; it isn't persisted, so a reopened planner is safe again.
  const [locked, setLocked] = useState(true)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ row: PlannerRow; point: { x: number; y: number } } | null>(
    null
  )
  const [spanEditor, setSpanEditor] = useState<{
    deliverable: PlannerDeliverable
    point: { x: number; y: number }
  } | null>(null)
  const [projectDate, setProjectDate] = useState<{
    project: PlannerProject
    point: { x: number; y: number }
  } | null>(null)
  const [create, setCreate] = useState<{
    request: CreateRequest
    run: (result: CreateResult) => Promise<void>
  } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const today = todayDate()

  const model = useMemo(() => buildPlannerModel(notes), [notes])
  const hiddenProjects = useConfigStore((s) => s.vaultConfig.hiddenProjects)
  const hidden = useMemo(() => new Set(hiddenProjects ?? []), [hiddenProjects])
  const plannerOrder = useConfigStore((s) => s.vaultConfig.plannerOrder)
  const order = useMemo(() => plannerOrder ?? {}, [plannerOrder])
  const rows = useMemo(
    () => flattenRows(model, collapsed, projectFilter, hidden, order),
    [model, collapsed, projectFilter, hidden, order]
  )
  const rowIndex = useMemo(() => rowIndexById(rows), [rows])
  const tops = useMemo(() => rowTops(rows), [rows])
  const chartHeight = useMemo(() => rowsHeight(rows), [rows])
  // Mirrors the bar drag in flight (see `useBarDrag` below); declared up here
  // because the domain grows to fit it.
  const [drag, setDrag] = useState<DragState | null>(null)
  const points = useMemo(() => datedPoints(model, rows), [model, rows])
  const projectByKey = useMemo(
    () => new Map(model.projects.map((p) => [projectOrderKey(p), p])),
    [model]
  )
  const dragPlan = useMemo(() => planDrag(model, projectByKey, drag), [model, projectByKey, drag])
  const dragReach = useMemo(
    () => dragReachOf(model, points, drag, dragPlan),
    [model, points, drag, dragPlan]
  )
  // Only ever widens while the planner is open — see `stableDomain`. A drag
  // past the chart's edge widens it too, so the bar always has room to go.
  const domainRef = useRef<Domain | null>(null)
  const domain = useMemo(() => {
    const base = domainOf(model, today)
    const next = dragReach ? widenDomain(base, dragReach.start, dragReach.end) : base
    return (domainRef.current = stableDomain(domainRef.current, next))
  }, [model, today, dragReach])
  const months = useMemo(() => monthBands(domain, zoom), [domain, zoom])
  const subs = useMemo(() => subBands(domain, zoom), [domain, zoom])
  const violated = useMemo(() => violatedDependencies(model), [model])
  const notePaths = useMemo(() => [...notes.keys()], [notes])
  const folders = useMemo(() => vaultFolders(notePaths), [notePaths])
  const width = gridWidth(domain, zoom)

  // ---------- Optimistic overlay ----------
  // Without this a dragged bar snaps back to its old dates for the frame or two
  // between the write and the index delta. The timer is a safety net: if the
  // delta never lands (a stale refusal, say), the preview clears itself rather
  // than lying about the schedule forever.
  const [pending, setPending] = useState<Pending | null>(null)
  useEffect(() => {
    // Drop each bar from the overlay only once the index shows it at its new
    // dates. A move writes several lines one after another (a deliverable,
    // then its work packages and dependents), and each lands as its own delta
    // — clearing everything on the first would snap the rest back for a beat
    // before their own writes arrived.
    setPending((prev) => {
      if (!prev) return prev
      const spans = new Map(
        [...prev.spans].filter(([id, span]) => {
          const d = model.byId.get(id)
          return !d || d.start !== span.start || d.end !== span.end
        })
      )
      const dates = lineDates(model)
      const points = new Map([...prev.points].filter(([key, date]) => dates.get(key) !== date))
      const projects = new Map(
        [...prev.projects].filter(([slug, o]) => {
          const p = model.projects.find((x) => x.slug === slug)
          return !!p && !sameProjectDates(p, o)
        })
      )
      if (
        spans.size === prev.spans.size &&
        points.size === prev.points.size &&
        projects.size === prev.projects.size
      )
        return prev
      if (spans.size + points.size + projects.size > 0) return { ...prev, spans, points, projects }
      window.clearTimeout(prev.timer)
      return null
    })
  }, [model])
  useEffect(() => () => (pending ? window.clearTimeout(pending.timer) : undefined), [pending])

  // Same idea for dropped milestones / task diamonds: row key → date written.
  const [pendingPoints, setPendingPoints] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    setPendingPoints((prev) => {
      if (prev.size === 0) return prev
      const next = new Map([...prev].filter(([key, date]) => points.get(key)?.date !== date))
      return next.size === prev.size ? prev : next
    })
  }, [points])

  const previewOf = useCallback(
    (id: string): Span | null => pending?.spans.get(id) ?? null,
    [pending]
  )

  // ---------- Drag ----------
  const commit = useCallback(
    (state: DragState) => {
      const point = points.get(state.id)
      if (point) {
        if (state.mode !== 'move' || state.deltaDays === 0) return
        const key = state.id
        // Held where it was dropped while the extend question (if any) is
        // open; `onPlan` then swaps in what will really be written.
        let date = addDays(point.date, state.deltaDays)
        setPendingPoints((prev) => new Map(prev).set(key, date))
        const clear = (): void =>
          setPendingPoints((prev) => {
            if (prev.get(key) !== date) return prev
            const next = new Map(prev)
            next.delete(key)
            return next
          })
        const onPlan = (planned: string, spans: Map<string, Span>): void => {
          date = planned
          setPendingPoints((prev) => new Map(prev).set(key, planned))
          // Safety net, as for bars: a refused write must not leave it parked.
          window.setTimeout(clear, 2000)
          if (spans.size > 0)
            setPending((prev) => {
              if (prev) window.clearTimeout(prev.timer)
              return {
                spans,
                points: new Map(),
                projects: new Map(),
                timer: window.setTimeout(() => setPending(null), 2000)
              }
            })
        }
        void moveDatedLine(model, point.owner, point.ref, point.date, state.deltaDays, onPlan).then(
          (ok) => ok || clear()
        )
        return
      }
      const project = projectByKey.get(state.id)
      if (project) {
        if (state.mode === 'link' || state.deltaDays === 0) return
        const dropped = planDrag(model, projectByKey, state)
        if (!dropped?.project) return
        const { slug, dates } = dropped.project
        // Held where it was dropped, with no timeout while a trim warning may
        // be open; `onPlan` then swaps in what's really written, project
        // window kept, and starts the safety timer.
        setPending((prev) => {
          if (prev) window.clearTimeout(prev.timer)
          return {
            spans: dropped.spans,
            points: dropped.points,
            projects: new Map([[slug, dates]]),
            timer: 0
          }
        })
        const onPlan = (spans: Map<string, Span>, planned: Map<string, string>): void =>
          setPending((prev) => {
            if (prev) window.clearTimeout(prev.timer)
            return {
              spans,
              points: planned,
              projects: new Map([[slug, dates]]),
              timer: window.setTimeout(() => setPending(null), 2000)
            }
          })
        if (state.mode === 'move') {
          void moveProject(model, project, state.deltaDays, onPlan)
          return
        }
        const edge = projectEdgeDates(
          project,
          state.mode === 'resize-start' ? 'start' : 'end',
          state.deltaDays
        )
        if (edge) void editProjectDates(project, edge, onPlan).then((ok) => ok || setPending(null))
        return
      }
      const d = model.byId.get(state.id)
      if (!d) return
      if (state.mode === 'link') {
        const target = state.targetId
        if (!target || target === state.id) return
        const dependent = model.byId.get(target)
        if (!dependent) return
        // Checked before any write: a loop would make the cascade order
        // meaningless and the arrows unreadable.
        if (wouldCycle(model, state.id, target)) {
          showToast(`${dependent.label} already comes before ${d.label} — that would be a loop`)
          return
        }
        void linkDependency(dependent, state.id)
        return
      }
      if (state.deltaDays === 0) return
      const start = state.mode === 'resize-end' ? d.start : addDays(d.start, state.deltaDays)
      const end = state.mode === 'resize-start' ? d.end : addDays(d.end, state.deltaDays)
      // Hold every bar where it was dropped — the dragged one plus whatever was
      // moving with it (work packages, dependents), exactly as the drag drew
      // them — with no timeout yet: the write may first ask whether to extend
      // a parent, and nothing should snap back while that question is open.
      // `onPlan` then swaps in what will actually be written (clamped, or with
      // the parent grown) and starts the timer.
      const dropped = new Map<string, Span>([[d.id, { start, end }]])
      if (state.mode !== 'resize-start')
        for (const id of cascadeShift(model, d.id, state.deltaDays, state.mode === 'move')) {
          const moved = model.byId.get(id)
          if (moved && id !== d.id)
            dropped.set(id, {
              start: addDays(moved.start, state.deltaDays),
              end: addDays(moved.end, state.deltaDays)
            })
        }
      // A shrink also holds the children it fits back inside.
      const fitted = planDrag(model, projectByKey, state)
      for (const [id, span] of fitted?.spans ?? []) if (!dropped.has(id)) dropped.set(id, span)
      setPending((prev) => {
        if (prev) window.clearTimeout(prev.timer)
        return {
          spans: dropped,
          points: fitted?.points ?? new Map(),
          projects: new Map(),
          timer: 0
        }
      })
      const onPlan = (spans: Map<string, Span>, planned: Map<string, string>): void =>
        setPending((prev) => {
          if (prev) window.clearTimeout(prev.timer)
          return spans.size === 0 && planned.size === 0
            ? null
            : {
                spans,
                points: planned,
                projects: new Map(),
                timer: window.setTimeout(() => setPending(null), 2000)
              }
        })
      if (state.mode === 'move') void moveDeliverable(model, state.id, state.deltaDays, onPlan)
      else void resizeDeliverable(model, d, start, end, onPlan)
    },
    [model, points, projectByKey]
  )

  const bar = useBarDrag({ zoom, scrollRef, leftInset: TREE_WIDTH, onCommit: commit })
  useEffect(() => setDrag(bar.drag), [bar.drag])
  const rebaseDrag = bar.rebase

  /** The span to draw for a deliverable: the live drag, then the pending write, then the model. */
  const spanFor = useCallback(
    (id: string): Span => {
      const d = model.byId.get(id)
      const base: Span = d ? { start: d.start, end: d.end } : { start: today, end: today }
      if (drag && drag.deltaDays !== 0 && d) {
        // The dragged bar itself, for a resize, only moves the edge under the
        // pointer — check this before the cascade below, which would otherwise
        // also match it (it's always the head of its own cascade).
        if (drag.id === id && drag.mode === 'resize-start')
          return { start: addDays(base.start, drag.deltaDays), end: base.end }
        if (drag.id === id && drag.mode === 'resize-end')
          return { start: base.start, end: addDays(base.end, drag.deltaDays) }
        // A move shifts the dragged bar and everything downstream of it by the
        // same delta; a resize-end only shifts what's downstream, since
        // extending or shrinking the finish date is exactly what a dependent
        // was waiting on.
        const cascading =
          (drag.mode === 'move' || drag.mode === 'resize-end') &&
          cascadeShift(model, drag.id, drag.deltaDays, drag.mode === 'move').includes(id)
        if (cascading)
          return {
            start: addDays(base.start, drag.deltaDays),
            end: addDays(base.end, drag.deltaDays)
          }
      }
      // A project drag's bars, or the children a shrinking bar fits inside it.
      return dragPlan?.spans.get(id) ?? previewOf(id) ?? base
    },
    [model, drag, dragPlan, previewOf, today]
  )

  /** Date to draw a milestone/task diamond at: the live drag, then the pending write, then the model. */
  const pointDate = (key: string, ref: { path: string; line: number }, date: string): string => {
    if (drag?.id === key && drag.mode === 'move') return addDays(date, drag.deltaDays)
    const line = lineKey(ref)
    return dragPlan?.points.get(line) ?? pendingPoints.get(key) ?? pending?.points.get(line) ?? date
  }

  /** `project` with its dates as a drag in flight, or a write not yet landed, leaves them. */
  const projectAsDrawn = (project: PlannerProject): PlannerProject => {
    const dates =
      dragPlan?.project?.slug === project.slug
        ? dragPlan.project.dates
        : pending?.projects.get(project.slug)
    return dates ? { ...project, ...dates } : project
  }

  // ---------- Scroll to today ----------
  // The tree pane is sticky-left inside the same scroller, so today is offset
  // by its width. Re-run on zoom so today stays put as the scale changes.
  const scrollToToday = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft = Math.max(0, TREE_WIDTH + dateToX(domain, today, zoom) - el.clientWidth / 3)
  }, [domain, today, zoom])

  const centeredOnce = useRef(false)
  useEffect(() => {
    if (centeredOnce.current || model.byId.size === 0) return
    centeredOnce.current = true
    scrollToToday()
  }, [model, scrollToToday])
  // Keyed on zoom alone: `scrollToToday` changes identity with the domain, and
  // re-running on that would yank the view back to today whenever an edit
  // grew the chart — e.g. dragging a bar right past its end.
  const scrollToTodayRef = useRef(scrollToToday)
  scrollToTodayRef.current = scrollToToday
  useEffect(() => scrollToTodayRef.current(), [zoom])

  // When the domain grows to the left, everything already drawn moves right
  // by the same amount; scroll with it so nothing on screen appears to move.
  const shownDomain = useRef(domain)
  useLayoutEffect(() => {
    const shift = domainShiftPx(shownDomain.current, domain, zoom)
    shownDomain.current = domain
    if (shift !== 0 && scrollRef.current) {
      scrollRef.current.scrollLeft += shift
      // That scroll isn't the pointer travelling — keep it out of the drag delta.
      rebaseDrag(shift)
    }
  }, [domain, zoom, rebaseDrag])

  // ---------- Default collapse ----------
  // Start every deliverable collapsed so the chart opens showing just the
  // deliverable bars, not every task under them. Runs once, the first time
  // the model has data — later index deltas must not stomp on the user's
  // own expand/collapse choices.
  const collapsedOnce = useRef(false)
  useEffect(() => {
    if (collapsedOnce.current || model.byId.size === 0) return
    collapsedOnce.current = true
    setCollapsed((prev) => {
      const next = new Set(prev)
      // `byId` covers every deliverable regardless of nesting — a
      // project's `deliverables` array holds root deliverables only.
      for (const deliverable of model.byId.values()) next.add(`d:${deliverable.id}`)
      return next
    })
  }, [model])

  // ---------- Actions ----------
  const toggle = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })

  /**
   * Saves one scope's row order to `.knote/config.json` — `null` drops it, so
   * the scope goes back to the computed order. Display-only: no note changes.
   */
  const saveOrder = (scope: string, keys: string[] | null): void => {
    const config = useConfigStore.getState().vaultConfig
    const next = { ...(config.plannerOrder ?? {}) }
    if (keys) next[scope] = keys
    else delete next[scope]
    const updated = { ...config, plannerOrder: next }
    useConfigStore.setState({ vaultConfig: updated })
    void host.setVaultConfig(updated)
  }

  const reorder = (dragged: PlannerRow, target: PlannerRow, position: 'before' | 'after'): void => {
    if (dragged.parentKey !== target.parentKey) return
    const scope = dragged.parentKey
    const current = scopeOrderKeys(model, scope, order)
    const next = moveInOrder(current, dragged.orderKey, target.orderKey, position)
    if (next.every((key, i) => key === current[i])) return
    saveOrder(scope, next)
  }

  const openRow = (row: PlannerRow): void => {
    if (row.kind === 'project') void host.openNote(row.project.path)
    else if (row.kind === 'deliverable')
      void host.openNote(row.deliverable.path, row.deliverable.line)
    else if (row.kind === 'task') void host.openNote(row.task.path, row.task.line)
    else void host.openNote(row.milestone.path, row.milestone.line)
  }

  const askNewProject = (): void =>
    setCreate({
      request: { kind: 'project', contextLabel: '' },
      run: async (r) => {
        await createProject(r.name, r.folder, r.date)
      }
    })

  /**
   * Nothing new goes into a completed project. Checked here as well as on the
   * menu items, so the rule holds however the action was reached (and so a
   * project closed while a dialog sat open doesn't take the write anyway).
   */
  const refuseIfClosed = (project: PlannerProject): boolean => {
    if (!project.complete) return false
    showToast(`${project.title} is completed — reopen it to add to it`)
    return true
  }

  const askNewDeliverable = (row: PlannerRow): void => {
    const project =
      row.kind === 'project' ? row.project : row.kind === 'deliverable' ? row.project : null
    if (!project || refuseIfClosed(project)) return
    setCreate({
      request: { kind: 'deliverable', contextLabel: project.title },
      run: (r) => addDeliverable(project.path, project.slug, r.name, r.start, r.end)
    })
  }

  /** Only offered on a root deliverable's row — a work package can't itself have one (nesting is capped at one level). */
  const askNewWorkPackage = (project: PlannerProject, parent: PlannerDeliverable): void => {
    if (refuseIfClosed(project)) return
    setCreate({
      request: {
        kind: 'workPackage',
        contextLabel: parent.label,
        dateBounds: { start: parent.start, end: parent.end }
      },
      run: (r) => addWorkPackage(parent, r.name, r.start, r.end)
    })
  }

  const askNewTask = (project: PlannerProject, d: PlannerDeliverable): void => {
    if (refuseIfClosed(project)) return
    setCreate({
      request: { kind: 'task', contextLabel: d.label },
      run: (r) => addTask(d, r.name)
    })
  }

  const askNewMilestone = (project: PlannerProject, d: PlannerDeliverable): void => {
    if (refuseIfClosed(project)) return
    setCreate({
      request: { kind: 'milestone', contextLabel: d.label },
      run: (r) => addMilestone(d, r.name, r.date)
    })
  }

  /** A milestone on the project itself — pinned to its row, owned by no deliverable. */
  const askNewProjectMilestone = (project: PlannerProject): void => {
    if (refuseIfClosed(project)) return
    setCreate({
      request: { kind: 'milestone', contextLabel: project.title },
      run: (r) => addProjectMilestone(project.path, r.name, r.date)
    })
  }

  /**
   * One row per other deliverable *in the same project* — dependencies can't
   * cross projects, so the list isn't diluted with candidates that could
   * never legally be picked. Checked where it's already a predecessor of `d`.
   * Clicking toggles the `⛓` marker. A candidate that would close a loop (it
   * already comes *after* `d`) is shown disabled rather than hidden, so the
   * reason it isn't offered is visible. A completed candidate is dropped
   * entirely to keep the list from growing without bound — unless `d`
   * already depends on it, in which case it stays so the link can be undone.
   */
  const dependencyEntries = (d: PlannerDeliverable): MenuEntry[] => {
    // Every deliverable of the project, not just its roots — `byId` is the
    // one place nesting doesn't hide a work package from a candidate list.
    const candidates = [...model.byId.values()].filter(
      (c) =>
        c.project === d.project &&
        c.id !== d.id &&
        (d.dependsOn.includes(c.id) || deliverableBarStatus(c, today) !== 'done')
    )
    if (candidates.length === 0)
      return [{ label: 'No other deliverables yet', disabled: true, onClick: () => {} }]
    return candidates.map((candidate) => {
      const linked = d.dependsOn.includes(candidate.id)
      const cycles = !linked && wouldCycle(model, candidate.id, d.id)
      return {
        label: candidate.label,
        checked: linked,
        detail: cycles ? 'would loop' : `ends ${candidate.end}`,
        disabled: cycles,
        onClick: () => {
          setMenu(null)
          void (linked ? unlinkDependency(d, candidate.id) : linkDependency(d, candidate.id))
        }
      }
    })
  }

  /**
   * The Color ▸ flyout: Default (clear the setting, inherit) plus one swatch
   * per palette name, checked where it's the row's own setting. `inherited`
   * is what Default resolves to, shown so it's clear what clearing gives you.
   */
  const colorEntries = (
    own: PlannerColor | null,
    inherited: PlannerColor,
    inheritedFrom: string,
    apply: (color: PlannerColor | null) => Promise<void>
  ): MenuEntry[] => {
    const pick = (color: PlannerColor | null) => () => {
      setMenu(null)
      if (color !== own) void apply(color)
    }
    return [
      {
        label: 'Default',
        icon: <span className={`planner-swatch planner-color-${inherited}`} />,
        ...(own === null ? { checked: true } : { detail: `${inheritedFrom} · ${inherited}` }),
        onClick: pick(null)
      },
      { separator: true },
      ...PLANNER_COLORS.map((color) => ({
        label: color[0].toUpperCase() + color.slice(1),
        icon: <span className={`planner-swatch planner-color-${color}`} />,
        checked: own === color,
        onClick: pick(color)
      }))
    ]
  }

  const menuItems = (row: PlannerRow): MenuEntry[] => {
    // The span picker opens where the menu did, so it lands under the pointer.
    const menuPoint = menu?.point ?? { x: 0, y: 0 }
    const items: MenuEntry[] = []
    // A completed project is closed for business — nothing new goes into it
    // until it's reopened, which is one click away in the same menu.
    const project = row.kind === 'project' ? row.project : 'project' in row ? row.project : null
    const closed = project?.complete ?? false
    const closedNote = closed ? `${project?.title} is completed` : undefined

    if (row.kind === 'project') {
      items.push(
        {
          label: 'Set project dates…',
          icon: <CalendarRange size={14} />,
          detail:
            row.project.startDate || row.project.dueDate
              ? `${row.project.startDate ?? '…'} → ${row.project.dueDate ?? '…'}`
              : 'none',
          onClick: () => {
            setMenu(null)
            setProjectDate({ project: row.project, point: menuPoint })
          }
        },
        {
          label: row.project.complete ? 'Reopen project' : 'Mark project completed',
          icon: row.project.complete ? <RotateCcw size={14} /> : <CheckCircle2 size={14} />,
          onClick: () => {
            setMenu(null)
            void setProjectComplete(
              row.project.path,
              notes.get(row.project.path)?.frontmatter ?? {},
              !row.project.complete
            )
          }
        },
        {
          label: 'Color',
          icon: <Palette size={14} />,
          submenu: colorEntries(
            row.project.color,
            defaultProjectColor(row.project, model),
            'auto',
            (color) =>
              setProjectColor(
                row.project.path,
                notes.get(row.project.path)?.frontmatter ?? {},
                color
              )
          )
        },
        { separator: true },
        {
          label: 'Add deliverable…',
          icon: <CalendarPlus size={14} />,
          disabled: closed,
          detail: closedNote,
          onClick: () => {
            setMenu(null)
            askNewDeliverable(row)
          }
        },
        {
          label: 'Add milestone…',
          icon: <Flag size={14} />,
          disabled: closed,
          detail: closedNote,
          onClick: () => {
            setMenu(null)
            askNewProjectMilestone(row.project)
          }
        }
      )
    }
    if (row.kind === 'deliverable') {
      const d = row.deliverable
      items.push(
        {
          label: 'Edit dates…',
          icon: <CalendarRange size={14} />,
          detail: `${d.start} → ${d.end}`,
          onClick: () => {
            setMenu(null)
            setSpanEditor({ deliverable: d, point: menuPoint })
          }
        },
        {
          // Every other deliverable, checked where it's already a predecessor.
          // Anything that would close a loop is listed but inert, so it's
          // visible *why* it isn't available rather than silently missing.
          label: 'Depends on',
          icon: <Link2 size={14} />,
          submenu: dependencyEntries(d)
        },
        {
          label: 'Color',
          icon: <Palette size={14} />,
          submenu: colorEntries(
            d.color,
            inheritedBarColor(d, row.project, model),
            d.parentId && model.byId.get(d.parentId)?.color ? 'from parent' : 'from project',
            (color) => setDeliverableColor(d, color)
          )
        },
        { separator: true },
        {
          label: 'Add task…',
          icon: <ListPlus size={14} />,
          disabled: closed,
          detail: closedNote,
          onClick: () => {
            setMenu(null)
            askNewTask(row.project, d)
          }
        },
        {
          label: 'Add milestone…',
          icon: <Flag size={14} />,
          disabled: closed,
          detail: closedNote,
          onClick: () => {
            setMenu(null)
            askNewMilestone(row.project, d)
          }
        },
        // A work package can't itself have one — nesting is capped at one
        // level — so this only ever shows up on a root deliverable's row.
        ...(d.parentId
          ? []
          : [
              {
                label: 'Add work package…',
                icon: <CornerDownRight size={14} />,
                disabled: closed,
                detail: closedNote,
                onClick: () => {
                  setMenu(null)
                  askNewWorkPackage(row.project, d)
                }
              }
            ]),
        {
          label: 'Add deliverable…',
          icon: <CalendarPlus size={14} />,
          disabled: closed,
          detail: closedNote,
          onClick: () => {
            setMenu(null)
            askNewDeliverable(row)
          }
        }
      )
    }
    items.push(
      { separator: true },
      ...(order[row.parentKey]
        ? [
            {
              label: 'Reset order',
              icon: <RotateCcw size={14} />,
              detail: 'this level',
              onClick: () => {
                setMenu(null)
                saveOrder(row.parentKey, null)
              }
            }
          ]
        : []),
      {
        label: 'Open in editor',
        onClick: () => {
          setMenu(null)
          openRow(row)
        }
      }
    )
    return items
  }

  const containerRect = bodyRef.current?.getBoundingClientRect() ?? null
  const linkTargetId = drag?.mode === 'link' ? drag.targetId : null

  return (
    <div className="planner-view">
      <div className="board-header">
        <div className="board-title">
          Planner <span className="board-scope">{today}</span>
        </div>
        <div className="board-controls">
          <select
            className="board-tag-select"
            value={projectFilter ?? ''}
            onChange={(e) => setProjectFilter(e.target.value || null)}
          >
            <option value="">All projects</option>
            {model.projects
              .filter((p) => !hidden.has(p.slug))
              .map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.title}
                </option>
              ))}
          </select>
          <div className="planner-zoom">
            {ZOOMS.map((z) => (
              <button
                key={z}
                className={`icon-btn planner-zoom-btn${z === zoom ? ' active' : ''}`}
                onClick={() => setZoom(z)}
              >
                {z}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={scrollToToday}>
            Today
          </button>
          <button
            className={`icon-btn planner-lock-btn${locked ? ' active' : ''}`}
            onClick={() => setLocked((l) => !l)}
            title={
              locked
                ? 'Bars and rows are locked — click to unlock and allow dragging'
                : 'Bars and rows are unlocked — click to lock and prevent dragging'
            }
          >
            {locked ? <Lock size={14} /> : <Unlock size={14} />} {locked ? 'Locked' : 'Unlocked'}
          </button>
          <button className="icon-btn" onClick={askNewProject} title="Create a new project note">
            <Plus size={14} /> Project
          </button>
        </div>
      </div>

      {model.projects.length === 0 ? (
        <div className="panel-empty planner-empty">
          <Package size={28} />
          <p>
            No projects yet. A project is any note with <code>type: project</code> in its
            frontmatter; its deliverables are top-level tasks carrying a span and a tag:
          </p>
          <pre>{`- [ ] Design 🛫 2026-04-01 📅 2026-04-20 @deliverable(govalle/design) ⛓ @deliverable(govalle/contracts)`}</pre>
          <p>
            Add <code>@deliverable(govalle/design)</code> to a task or milestone anywhere in the
            vault and it joins the deliverable — and shows on your board while the deliverable is
            running.
          </p>
          <button className="icon-btn" onClick={askNewProject}>
            <Plus size={14} /> New project
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="panel-empty planner-empty">
          <Package size={28} />
          <p>
            {hidden.size > 0
              ? 'Every project is unticked in the Projects sidebar. Tick one to put it back on the chart.'
              : 'No project matches the current filter.'}
          </p>
        </div>
      ) : (
        <div className="planner-scroll" ref={scrollRef}>
          <div className="planner-canvas" style={{ width: TREE_WIDTH + width }}>
            <div className="planner-corner" style={{ width: TREE_WIDTH }} />
            <GridHeader
              domain={domain}
              zoom={zoom}
              months={months}
              subs={subs}
              today={today}
              width={width}
            />
            <TreePane
              rows={rows}
              tops={tops}
              height={chartHeight}
              collapsed={collapsed}
              onToggle={toggle}
              onOpen={openRow}
              onReorder={reorder}
              locked={locked}
              onContextMenu={(e, row) => {
                e.preventDefault()
                setMenu({ row, point: { x: e.clientX, y: e.clientY } })
              }}
              width={TREE_WIDTH}
            />
            <div className="planner-chart" ref={bodyRef}>
              <GridBody domain={domain} zoom={zoom} today={today} height={chartHeight}>
                {rows.map((row, i) => (
                  <div
                    key={row.key}
                    // The divider runs across the chart too, so the split
                    // between projects reads all the way over.
                    className={`planner-lane${row.kind === 'project' && i > 0 ? ' project-start' : ''}`}
                    style={{ top: tops[i], height: ROW_HEIGHT }}
                  >
                    {row.kind === 'project' &&
                      (() => {
                        const w = projectWindow(projectAsDrawn(row.project))
                        return (
                          w && (
                            <ProjectWindow
                              window={w}
                              title={row.project.title}
                              color={row.project.color ?? defaultProjectColor(row.project, model)}
                              domain={domain}
                              zoom={zoom}
                              dragging={drag?.id === row.key}
                              locked={locked}
                              onGrip={(e, mode) => {
                                if (!locked) bar.start(e, row.key, mode)
                              }}
                              onOpen={() => openRow(row)}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                setMenu({ row, point: { x: e.clientX, y: e.clientY } })
                              }}
                            />
                          )
                        )
                      })()}
                    {row.kind === 'deliverable' &&
                      (() => {
                        const span = spanFor(row.deliverable.id)
                        return (
                          <Bar
                            deliverable={row.deliverable}
                            start={span.start}
                            end={span.end}
                            domain={domain}
                            zoom={zoom}
                            color={barColor(row.deliverable, row.project, model)}
                            status={deliverableBarStatus(row.deliverable, today)}
                            violated={violated.has(row.deliverable.id)}
                            dragging={drag?.id === row.deliverable.id}
                            linkTarget={linkTargetId === row.deliverable.id}
                            locked={locked}
                            onGrip={(e, mode) => {
                              if (locked) return
                              bar.start(e, row.deliverable.id, mode)
                            }}
                            onOpen={() => openRow(row)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              setMenu({ row, point: { x: e.clientX, y: e.clientY } })
                            }}
                          />
                        )
                      })()}
                    {row.kind === 'milestone' && (
                      <MilestoneMark
                        milestone={{
                          ...row.milestone,
                          date: pointDate(row.key, row.milestone, row.milestone.date)
                        }}
                        domain={domain}
                        zoom={zoom}
                        dragging={drag?.id === row.key}
                        locked={locked}
                        onPointerDown={(e) => {
                          if (!locked) bar.start(e, row.key, 'move')
                        }}
                        onOpen={() => openRow(row)}
                      />
                    )}
                    {row.kind === 'task' && row.task.due && (
                      <MilestoneMark
                        milestone={{
                          ...row.task,
                          text: row.task.text,
                          date: pointDate(row.key, row.task, row.task.due),
                          important: false
                        }}
                        domain={domain}
                        zoom={zoom}
                        dragging={drag?.id === row.key}
                        locked={locked}
                        onPointerDown={(e) => {
                          if (!locked) bar.start(e, row.key, 'move')
                        }}
                        onOpen={() => openRow(row)}
                      />
                    )}
                  </div>
                ))}
                <DependencyArrows
                  model={model}
                  rowIndex={rowIndex}
                  tops={tops}
                  spanFor={spanFor}
                  domain={domain}
                  zoom={zoom}
                  width={width}
                  height={chartHeight}
                  violated={violated}
                >
                  {drag?.mode === 'link' && drag.point && (
                    <LinkPreview
                      fromId={drag.id}
                      rowIndex={rowIndex}
                      tops={tops}
                      spanFor={spanFor}
                      domain={domain}
                      zoom={zoom}
                      pointer={drag.point}
                      containerRect={containerRect}
                    />
                  )}
                </DependencyArrows>
              </GridBody>
            </div>
          </div>
        </div>
      )}

      {menu && (
        <Popover anchorPoint={menu.point} onClose={() => setMenu(null)}>
          <ContextMenuList items={menuItems(menu.row)} />
        </Popover>
      )}
      {spanEditor &&
        (() => {
          // Re-read from the live model: an index delta may have landed while
          // the picker was open, and editing from stale dates would write a
          // span the user never saw.
          const d = model.byId.get(spanEditor.deliverable.id) ?? spanEditor.deliverable
          const parent = d.parentId ? model.byId.get(d.parentId) : undefined
          const project = parent ? undefined : model.projects.find((p) => p.slug === d.project)
          return (
            <Popover anchorPoint={spanEditor.point} onClose={() => setSpanEditor(null)}>
              <SpanPicker
                deliverable={d}
                bound={
                  parent
                    ? {
                        label: `deliverable “${parent.label}”`,
                        start: parent.start,
                        end: parent.end
                      }
                    : project && (project.startDate || project.dueDate)
                      ? {
                          label: `project “${project.title}”`,
                          start: project.startDate,
                          end: project.dueDate
                        }
                      : undefined
                }
                onApply={(start, end) => {
                  setSpanEditor(null)
                  void resizeDeliverable(model, d, start, end)
                }}
              />
            </Popover>
          )
        })()}
      {projectDate &&
        (() => {
          // Live model, like the span editor above: a delta may have landed meanwhile.
          const project =
            model.projects.find((p) => p.path === projectDate.project.path) ?? projectDate.project
          return (
            <Popover anchorPoint={projectDate.point} onClose={() => setProjectDate(null)}>
              <ProjectDatesPicker
                project={project}
                onApply={(start, end) => {
                  setProjectDate(null)
                  void editProjectDates(project, { start, end })
                }}
              />
            </Popover>
          )
        })()}
      {create && (
        <CreateDialog
          request={create.request}
          folders={folders}
          notePaths={notePaths}
          onCancel={() => setCreate(null)}
          onSubmit={(result) => {
            const run = create.run
            setCreate(null)
            void run(result)
          }}
        />
      )}
    </div>
  )
}
