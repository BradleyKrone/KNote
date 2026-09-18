/**
 * The planner's whole data model, derived from the vault index and nothing
 * else. Pure: takes the same `Map<VaultPath, NoteMeta>` every webview already
 * mirrors and returns the project → deliverable → task/milestone tree plus the
 * dependency graph, so all of it is unit-testable without a host.
 *
 * Nothing here is stored in the index: a deliverable is a top-level checkbox
 * task in a `type: project` note with a `🛫`/`📅` span and its own
 * `@deliverable(<project>/<name>)` marker, and its members are every other task
 * or 🏁 milestone in the vault carrying that same marker. *Which* line that is
 * comes from `deliverableDefinitions` in `@shared/deliverables` — the same pass
 * the Kanban board reads, so the two views can't drift.
 */

import type { NoteMeta, VaultPath } from '@shared/types'
import { DEPENDS_RE, PRIORITY_RE, dependsTag, stripInlineMarkers } from '@shared/parser/patterns'
import type { DeliverableDefinition } from '@shared/deliverables'
import {
  deliverableDefinitions,
  deliverableMembershipOf,
  deliverableProgress,
  endDateOf,
  isProjectComplete,
  isProjectNote,
  isTaskDone,
  projectEndDate,
  projectSlug
} from '@shared/deliverables'

/** A line the planner can point at and verify-rewrite. */
interface LineRef {
  path: VaultPath
  line: number
  rawLine: string
}

export interface PlannerTask extends LineRef {
  text: string
  done: boolean
  statusChar: string
  due: string | null
  /** Title of the note the task lives in — shown when it isn't the project note. */
  noteTitle: string
  foreign: boolean
}

export interface PlannerMilestone extends LineRef {
  text: string
  date: string
  important: boolean
}

export interface PlannerDeliverable extends LineRef {
  /** The bare deliverable tag — the planner's stable id for this row. */
  id: string
  project: string
  label: string
  start: string
  end: string
  statusChar: string
  dependsOn: string[]
  tasks: PlannerTask[]
  milestones: PlannerMilestone[]
  /** Bare tag of the deliverable this is a work package of, or null at the top level. */
  parentId: string | null
  /** This deliverable's own work packages — none of which can have one of their own, since nesting is capped at one level. */
  workPackages: PlannerDeliverable[]
  /**
   * 0–100, from `deliverableProgress` — its own member tasks' done ratio
   * rolled up with every work package's (or its own checkbox when there's
   * neither).
   */
  percent: number
}

/**
 * `complete` is declared (`status: completed`); `overdue` means its own target
 * end date has passed with work still open. A project with no `end:` date is
 * never overdue — the derived end (its latest deliverable) is a consequence of
 * the schedule, not a commitment to judge it against.
 */
export type ProjectStatus = 'complete' | 'overdue' | 'active'

export interface PlannerProject {
  slug: string
  title: string
  path: VaultPath
  deliverables: PlannerDeliverable[]
  /** Milestones in the project note that name no deliverable — pinned to the project row. */
  milestones: PlannerMilestone[]
  start: string | null
  /** Latest deliverable end — what the chart draws. */
  end: string | null
  /** The project's own `end:` frontmatter target, if it declared one. */
  dueDate: string | null
  status: ProjectStatus
  /** Closed for business: no new deliverables or tasks. */
  complete: boolean
  percent: number
}

export interface PlannerModel {
  projects: PlannerProject[]
  /** Every deliverable by id, across all projects. */
  byId: Map<string, PlannerDeliverable>
  /** predecessor id → dependent ids. */
  dependents: Map<string, string[]>
}

function dependenciesOf(text: string): string[] {
  return [...text.matchAll(DEPENDS_RE)].map(dependsTag)
}

export function buildPlannerModel(
  notes: ReadonlyMap<string, NoteMeta>,
  /** Today, injectable so the overdue rule is testable without faking the clock. */
  now: string = new Date().toISOString().slice(0, 10)
): PlannerModel {
  const projects: PlannerProject[] = []
  const byId = new Map<string, PlannerDeliverable>()
  // Which line defines which deliverable is decided in exactly one place, shared
  // with the Kanban board — see `deliverableDefinitions`. The planner must not
  // re-derive it: when it did, board and planner disagreed about a deliverable's
  // window and its tasks silently vanished from the board.
  const definitionsByPath = new Map<VaultPath, DeliverableDefinition[]>()
  for (const definition of deliverableDefinitions(notes).values()) {
    const forNote = definitionsByPath.get(definition.path)
    if (forNote) forNote.push(definition)
    else definitionsByPath.set(definition.path, [definition])
  }

  // Pass 1 — projects and their deliverable definitions.
  for (const meta of notes.values()) {
    if (!isProjectNote(meta)) continue
    const slug = projectSlug(meta)
    const project: PlannerProject = {
      slug,
      title: String(meta.frontmatter['title'] ?? meta.title),
      path: meta.path,
      deliverables: [],
      milestones: [],
      start: null,
      end: null,
      dueDate: projectEndDate(meta),
      status: 'active',
      complete: isProjectComplete(meta),
      percent: 0
    }
    for (const definition of definitionsByPath.get(meta.path) ?? []) {
      if (byId.has(definition.tag)) continue
      const deliverable: PlannerDeliverable = {
        id: definition.tag,
        project: slug,
        label: definition.label,
        path: definition.path,
        line: definition.line,
        rawLine: definition.rawLine,
        start: definition.start,
        end: definition.end,
        statusChar: definition.statusChar,
        dependsOn: dependenciesOf(definition.text),
        tasks: [],
        milestones: [],
        parentId: definition.parentTag,
        workPackages: [],
        percent: 0
      }
      // Attached to `project.deliverables` (roots) vs. a parent's
      // `workPackages` once every deliverable exists — see below.
      byId.set(definition.tag, deliverable)
    }
    projects.push(project)
  }

  const projectBySlug = new Map(projects.map((p) => [p.slug, p]))

  // Slot every deliverable under its parent's `workPackages`, or as a root of
  // its own project when it has none (or its declared parent belongs to a
  // different project — `deliverableDefinitions` never resolves one of
  // those, but the fallback keeps this pass total regardless).
  for (const deliverable of byId.values()) {
    const parent = deliverable.parentId ? byId.get(deliverable.parentId) : undefined
    if (parent) parent.workPackages.push(deliverable)
    else projectBySlug.get(deliverable.project)?.deliverables.push(deliverable)
  }

  // Pass 2 — members, from anywhere in the vault.
  for (const meta of notes.values()) {
    const isProject = isProjectNote(meta)
    for (const task of meta.tasks) {
      for (const tag of deliverableMembershipOf(task.tags, task.text)) {
        const deliverable = byId.get(tag)
        // The deliverable's own defining line is not one of its member tasks.
        if (!deliverable || (deliverable.path === meta.path && deliverable.line === task.line))
          continue
        deliverable.tasks.push({
          path: meta.path,
          line: task.line,
          rawLine: task.rawLine,
          text: stripInlineMarkers(task.text),
          done: isTaskDone(task),
          statusChar: task.statusChar,
          due: endDateOf(task.text),
          noteTitle: meta.title,
          foreign: meta.path !== deliverable.path
        })
      }
    }
    for (const milestone of meta.milestones) {
      const date = endDateOf(milestone.text)
      if (!date) continue
      const item: PlannerMilestone = {
        path: meta.path,
        line: milestone.line,
        rawLine: milestone.rawLine,
        text: stripInlineMarkers(milestone.text),
        date,
        important: PRIORITY_RE.test(milestone.text)
      }
      const tags = deliverableMembershipOf(milestone.tags, milestone.text)
      let placed = false
      for (const tag of tags) {
        const deliverable = byId.get(tag)
        if (deliverable) {
          deliverable.milestones.push(item)
          placed = true
        }
      }
      // An unowned 🏁 in a project note still belongs on the chart — pin it to
      // the project row rather than dropping it on the floor.
      if (!placed && isProject) projectBySlug.get(projectSlug(meta))?.milestones.push(item)
    }
  }

  // Pass 3 — rollups and ordering. Percent comes from `deliverableProgress`,
  // which already rolls a deliverable's work packages into its own ratio —
  // every deliverable, root or work package, is visited here via `byId` so
  // none of them keep a stale 0%.
  const progress = deliverableProgress(notes)
  for (const d of byId.values()) {
    d.tasks.sort((a, b) => Number(a.done) - Number(b.done) || a.text.localeCompare(b.text))
    d.milestones.sort((a, b) => a.date.localeCompare(b.date))
    d.workPackages.sort((a, b) => a.start.localeCompare(b.start) || a.line - b.line)
    const p = progress.get(d.id)
    d.percent = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : isTaskDone(d) ? 100 : 0
  }
  for (const project of projects) {
    project.deliverables.sort((a, b) => a.start.localeCompare(b.start) || a.line - b.line)
    const starts = project.deliverables.map((d) => d.start)
    const ends = project.deliverables.map((d) => d.end)
    project.start = starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null
    project.end = ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null
    project.percent = project.deliverables.length
      ? Math.round(
          project.deliverables.reduce((sum, d) => sum + d.percent, 0) / project.deliverables.length
        )
      : 0
    project.status = project.complete
      ? 'complete'
      : // Overdue needs a declared target *and* unfinished work: a project past
        // its date with everything ticked is simply finished, and nagging about
        // it would just train you to ignore the flag.
        project.dueDate !== null && project.dueDate < now && project.percent < 100
        ? 'overdue'
        : 'active'
    project.milestones.sort((a, b) => a.date.localeCompare(b.date))
  }
  // Live projects first, finished ones out of the way at the bottom.
  projects.sort((a, b) => Number(a.complete) - Number(b.complete) || a.title.localeCompare(b.title))

  // Dependency edges, predecessor → dependents. Edges to unknown ids are
  // dropped so a typo'd or deleted predecessor can't strand the graph.
  const dependents = new Map<string, string[]>()
  for (const d of byId.values()) {
    for (const dep of d.dependsOn) {
      if (!byId.has(dep) || dep === d.id) continue
      const list = dependents.get(dep) ?? []
      if (!list.includes(d.id)) list.push(d.id)
      dependents.set(dep, list)
    }
  }

  return { projects, byId, dependents }
}

/**
 * Every folder the vault actually has, derived from the note paths in the
 * index — including intermediate ones that hold nothing but subfolders, so a
 * `Clients/` with only `Clients/Govalle/Notes.md` under it is still offered.
 * Hidden folders (`.knote`, `.obsidian`) are left out; nothing goes in them by
 * hand. Sorted so the picker reads like a tree.
 */
export function vaultFolders(paths: Iterable<string>): string[] {
  const folders = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/')
    parts.pop() // the filename
    let prefix = ''
    for (const part of parts) {
      if (part.startsWith('.')) break
      prefix = prefix ? `${prefix}/${part}` : part
      folders.add(prefix)
    }
  }
  return [...folders].sort((a, b) => a.localeCompare(b))
}

/**
 * The immediate subfolders of `parent` ('' = the vault root), as full paths.
 * Drives one level of the folder browser — the picker walks down a level at a
 * time rather than rendering the whole tree, so a deep vault costs nothing.
 */
export function childFolders(folders: Iterable<string>, parent: string): string[] {
  const prefix = parent ? `${parent}/` : ''
  const children = new Set<string>()
  for (const folder of folders) {
    if (!folder.startsWith(prefix) || folder === parent) continue
    const rest = folder.slice(prefix.length)
    if (rest && !rest.includes('/')) children.add(folder)
  }
  return [...children].sort((a, b) => a.localeCompare(b))
}

/** Notes sitting directly in `folder` ('' = the vault root) — the browser shows them greyed for context. */
export function notesInFolder(paths: Iterable<string>, folder: string): string[] {
  const prefix = folder ? `${folder}/` : ''
  const notes: string[] = []
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    if (rest && !rest.includes('/')) notes.push(rest)
  }
  return notes.sort((a, b) => a.localeCompare(b))
}

/**
 * Ids that must move when `id` is dragged by `days`: the dragged deliverable
 * plus everything transitively downstream of it. Deliverables that merely sit
 * nearby, or that `id` itself depends on, never move — a drag only ever pushes
 * work that was waiting on it.
 *
 * Returned in topological-ish order (BFS from the dragged node), which is the
 * order the writes go out in. A cycle can't loop forever here: `seen` admits
 * each id once.
 */
export function cascadeShift(model: PlannerModel, id: string, days: number): string[] {
  if (!model.byId.has(id)) return []
  const order: string[] = []
  const seen = new Set<string>()
  const queue = [id]
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (seen.has(current)) continue
    seen.add(current)
    order.push(current)
    if (days === 0) continue
    for (const next of model.dependents.get(current) ?? []) queue.push(next)
  }
  return order
}

/**
 * Whether adding `predecessor → dependent` would close a loop — checked before
 * any write, since a cycle would make the cascade order meaningless and the
 * arrows unreadable.
 */
export function wouldCycle(model: PlannerModel, predecessor: string, dependent: string): boolean {
  if (predecessor === dependent) return true
  const seen = new Set<string>()
  const queue = [dependent]
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (current === predecessor) return true
    if (seen.has(current)) continue
    seen.add(current)
    queue.push(...(model.dependents.get(current) ?? []))
  }
  return false
}

export type DeliverableBarStatus = 'active' | 'overdue' | 'done'

/**
 * Bar color state: `done` wins over `overdue` — a finished deliverable past
 * its due date is not late, it's just late-finished. `done` requires the
 * deliverable's own checkbox *and* every member task checked — `d.percent`
 * alone isn't enough, since it's only the member-task ratio (or, with no
 * members, just the deliverable's own checkbox) and never both at once.
 */
export function deliverableBarStatus(d: PlannerDeliverable, today: string): DeliverableBarStatus {
  if (isTaskDone(d) && d.tasks.every((t) => t.done)) return 'done'
  if (d.end < today) return 'overdue'
  return 'active'
}

/** Deliverables whose start precedes the end of something they depend on. */
export function violatedDependencies(model: PlannerModel): Set<string> {
  const bad = new Set<string>()
  for (const d of model.byId.values()) {
    for (const dep of d.dependsOn) {
      const pred = model.byId.get(dep)
      if (pred && d.start < pred.end) bad.add(d.id)
    }
  }
  return bad
}
