/**
 * The planner's whole data model, derived from the vault index and nothing
 * else. Pure: takes the same `Map<VaultPath, NoteMeta>` every webview already
 * mirrors and returns the project → deliverable → task/milestone tree plus the
 * dependency graph, so all of it is unit-testable without a host.
 *
 * Nothing here is stored in the index: a deliverable is a top-level checkbox
 * task in a `type: project` note with a `🛫`/`📅` span and its own
 * `@deliverable(<project>/<name>)` marker, and its members are every other task
 * or 🏁 milestone in the vault carrying that same marker.
 */

import type { NoteMeta, VaultPath } from '@shared/types'
import {
  DEPENDS_RE,
  PRIORITY_RE,
  dependsTag,
  parseDeliverableTag,
  stripInlineMarkers
} from '@shared/parser/patterns'
import {
  deliverableMembershipOf,
  deliverableTagsOf,
  endDateOf,
  isProjectComplete,
  isProjectNote,
  isTaskDone,
  projectEndDate,
  projectSlug,
  startDateOf
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
  /** 0–100, from its tasks' done ratio (or its own checkbox when it has none). */
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
    for (const task of meta.tasks) {
      if (task.isSubtask) continue
      const end = endDateOf(task.text)
      if (!end) continue
      const tag = deliverableTagsOf(task.tags, task.text).find(
        (t) => parseDeliverableTag(t)?.project === slug
      )
      if (!tag || byId.has(tag)) continue
      const start = startDateOf(task.text) ?? end
      const deliverable: PlannerDeliverable = {
        id: tag,
        project: slug,
        label: stripInlineMarkers(task.text) || tag,
        path: meta.path,
        line: task.line,
        rawLine: task.rawLine,
        start: start <= end ? start : end,
        end,
        statusChar: task.statusChar,
        dependsOn: dependenciesOf(task.text),
        tasks: [],
        milestones: [],
        percent: 0
      }
      project.deliverables.push(deliverable)
      byId.set(tag, deliverable)
    }
    projects.push(project)
  }

  const projectBySlug = new Map(projects.map((p) => [p.slug, p]))

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

  // Pass 3 — rollups and ordering.
  for (const project of projects) {
    project.deliverables.sort((a, b) => a.start.localeCompare(b.start) || a.line - b.line)
    for (const d of project.deliverables) {
      d.tasks.sort((a, b) => Number(a.done) - Number(b.done) || a.text.localeCompare(b.text))
      d.milestones.sort((a, b) => a.date.localeCompare(b.date))
      d.percent = percentComplete(d)
    }
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
 * A deliverable's completion: the share of its member tasks that are done, or
 * — when it has no tasks at all — its own checkbox, so an unbroken-down
 * deliverable still reads as 0% or 100% rather than a permanently empty bar.
 */
export function percentComplete(deliverable: PlannerDeliverable): number {
  const { tasks } = deliverable
  if (tasks.length === 0) return isTaskDone(deliverable) ? 100 : 0
  return Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100)
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
