// The project planner: a Gantt chart over the vault's `type: project` notes.
//
// Everything on screen is derived from the index (buildPlannerModel) and every
// change is written straight back as a verified single-line edit, so the note
// stays the source of truth and an external edit reconciles by simply
// re-rendering from the next index delta.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarPlus,
  CalendarRange,
  CheckCircle2,
  Flag,
  Link2,
  ListPlus,
  Package,
  Plus,
  RotateCcw
} from 'lucide-react'
import { DatePickerContent } from '../shared/components/DatePickerContent'
import { host } from '../shared/rpc'
import { showToast, useConfigStore, useIndexStore } from '../shared/stores'
import { Popover } from '../shared/components/Popover'
import { ContextMenuList, type MenuEntry } from '../shared/components/ContextMenuList'
import { Bar, MilestoneMark } from './Bar'
import { CreateDialog, type CreateRequest, type CreateResult } from './CreateDialogs'
import { DependencyArrows, LinkPreview, type Span } from './DependencyArrows'
import { GridBody, GridHeader } from './TimeGrid'
import { SpanPicker } from './SpanPicker'
import { TreePane } from './TreePane'
import { useBarDrag, type DragState } from './useBarDrag'
import {
  addDays,
  dateToX,
  domainOf,
  flattenRows,
  gridWidth,
  monthBands,
  rowIndexById,
  rowsHeight,
  rowTops,
  ROW_HEIGHT,
  subBands,
  today as todayDate,
  type PlannerRow,
  type Zoom
} from './plannerLayout'
import {
  buildPlannerModel,
  cascadeShift,
  vaultFolders,
  violatedDependencies,
  wouldCycle,
  type PlannerDeliverable,
  type PlannerProject
} from './plannerSelectors'
import {
  addDeliverable,
  addMilestone,
  addTask,
  createProject,
  linkDependency,
  moveDeliverable,
  resizeDeliverable,
  setProjectComplete,
  setProjectEndDate,
  unlinkDependency
} from './plannerActions'

const TREE_WIDTH = 260
const ZOOMS: Zoom[] = ['day', 'week', 'month']

/** A drag's committed dates take a moment to come back as an index delta; show them meanwhile. */
interface Pending {
  spans: Map<string, Span>
  timer: number
}

export function PlannerApp(): React.JSX.Element {
  const notes = useIndexStore((s) => s.notes)
  const [zoom, setZoom] = useState<Zoom>('week')
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
  const rows = useMemo(
    () => flattenRows(model, collapsed, projectFilter, hidden),
    [model, collapsed, projectFilter, hidden]
  )
  const rowIndex = useMemo(() => rowIndexById(rows), [rows])
  const tops = useMemo(() => rowTops(rows), [rows])
  const chartHeight = useMemo(() => rowsHeight(rows), [rows])
  const domain = useMemo(() => domainOf(model, today), [model, today])
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
    if (pending) setPending(null)
    // Any index change means the write came back — drop the overlay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes])
  useEffect(() => () => (pending ? window.clearTimeout(pending.timer) : undefined), [pending])

  const previewOf = useCallback(
    (id: string): Span | null => pending?.spans.get(id) ?? null,
    [pending]
  )

  // ---------- Drag ----------
  const [drag, setDrag] = useState<DragState | null>(null)

  const commit = useCallback(
    (state: DragState) => {
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
      if (state.mode === 'move') {
        // Preview the whole cascade, not just the bar under the pointer.
        const spans = new Map<string, Span>()
        for (const id of cascadeShift(model, state.id, state.deltaDays)) {
          const moved = model.byId.get(id)
          if (moved)
            spans.set(id, {
              start: addDays(moved.start, state.deltaDays),
              end: addDays(moved.end, state.deltaDays)
            })
        }
        startPending(spans)
        void moveDeliverable(model, state.id, state.deltaDays)
        return
      }
      const start = state.mode === 'resize-start' ? addDays(d.start, state.deltaDays) : d.start
      const end = state.mode === 'resize-end' ? addDays(d.end, state.deltaDays) : d.end
      startPending(new Map([[d.id, { start, end }]]))
      void resizeDeliverable(d, start, end)

      function startPending(spans: Map<string, Span>): void {
        setPending((prev) => {
          if (prev) window.clearTimeout(prev.timer)
          return { spans, timer: window.setTimeout(() => setPending(null), 2000) }
        })
      }
    },
    [model]
  )

  const bar = useBarDrag({ zoom, scrollRef, onCommit: commit })
  useEffect(() => setDrag(bar.drag), [bar.drag])

  /** The span to draw for a deliverable: the live drag, then the pending write, then the model. */
  const spanFor = useCallback(
    (id: string): Span => {
      const d = model.byId.get(id)
      const base: Span = d ? { start: d.start, end: d.end } : { start: today, end: today }
      if (drag && drag.deltaDays !== 0 && d) {
        const moving =
          drag.mode === 'move' ? cascadeShift(model, drag.id, drag.deltaDays).includes(id) : false
        if (moving)
          return {
            start: addDays(base.start, drag.deltaDays),
            end: addDays(base.end, drag.deltaDays)
          }
        if (drag.id === id && drag.mode === 'resize-start')
          return { start: addDays(base.start, drag.deltaDays), end: base.end }
        if (drag.id === id && drag.mode === 'resize-end')
          return { start: base.start, end: addDays(base.end, drag.deltaDays) }
      }
      return previewOf(id) ?? base
    },
    [model, drag, previewOf, today]
  )

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
  useEffect(() => scrollToToday(), [zoom, scrollToToday])

  // ---------- Actions ----------
  const toggle = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })

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

  /**
   * One row per other deliverable, checked where it's already a predecessor of
   * `d`. Clicking toggles the `⛓` marker. A candidate that would close a loop
   * (it already comes *after* `d`) is shown disabled rather than hidden, so the
   * reason it isn't offered is visible.
   */
  const dependencyEntries = (d: PlannerDeliverable): MenuEntry[] => {
    const entries: MenuEntry[] = []
    for (const project of model.projects) {
      const candidates = project.deliverables.filter((c) => c.id !== d.id)
      if (candidates.length === 0) continue
      if (model.projects.length > 1) entries.push({ separator: true })
      for (const candidate of candidates) {
        const linked = d.dependsOn.includes(candidate.id)
        const cycles = !linked && wouldCycle(model, candidate.id, d.id)
        entries.push({
          label: candidate.label,
          checked: linked,
          detail: cycles ? 'would loop' : `ends ${candidate.end}`,
          disabled: cycles,
          onClick: () => {
            setMenu(null)
            void (linked ? unlinkDependency(d, candidate.id) : linkDependency(d, candidate.id))
          }
        })
      }
    }
    if (entries.length === 0)
      entries.push({ label: 'No other deliverables yet', disabled: true, onClick: () => {} })
    return entries
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
          label: 'Set target end date…',
          icon: <CalendarRange size={14} />,
          detail: row.project.dueDate ?? 'none',
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
                            colorIndex={model.projects.indexOf(row.project)}
                            violated={violated.has(row.deliverable.id)}
                            dragging={drag?.id === row.deliverable.id}
                            linkTarget={linkTargetId === row.deliverable.id}
                            onGrip={(e, mode) => bar.start(e, row.deliverable.id, mode)}
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
                        milestone={row.milestone}
                        domain={domain}
                        zoom={zoom}
                        onOpen={() => openRow(row)}
                      />
                    )}
                    {row.kind === 'task' && row.task.due && (
                      <MilestoneMark
                        milestone={{
                          ...row.task,
                          text: row.task.text,
                          date: row.task.due,
                          important: false
                        }}
                        domain={domain}
                        zoom={zoom}
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
      {spanEditor && (
        <Popover anchorPoint={spanEditor.point} onClose={() => setSpanEditor(null)}>
          <SpanPicker
            // Re-read from the live model: an index delta may have landed while
            // the picker was open, and editing from stale dates would write a
            // span the user never saw.
            deliverable={model.byId.get(spanEditor.deliverable.id) ?? spanEditor.deliverable}
            onApply={(start, end) => {
              const d = model.byId.get(spanEditor.deliverable.id) ?? spanEditor.deliverable
              setSpanEditor(null)
              void resizeDeliverable(d, start, end)
            }}
          />
        </Popover>
      )}
      {projectDate && (
        <Popover anchorPoint={projectDate.point} onClose={() => setProjectDate(null)}>
          <DatePickerContent
            currentDate={projectDate.project.dueDate}
            onSelect={(date) => {
              const path = projectDate.project.path
              setProjectDate(null)
              void setProjectEndDate(path, notes.get(path)?.frontmatter ?? {}, date)
            }}
          />
        </Popover>
      )}
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
