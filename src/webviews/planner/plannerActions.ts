// Planner → file writes. Every one of them is a verified edit against an exact
// line the model already holds, so a note that changed underneath us is refused
// with KNOTE_STALE and toasted rather than clobbered.

import { isStaleError } from '@shared/errors'
import {
  PROJECT_END_KEY,
  PROJECT_STATUS_KEY,
  deliverableRefMarker,
  slugify
} from '@shared/deliverables'
import { parseDeliverableTag, TASK_MARKER } from '@shared/parser/patterns'
import { taskChildIndent } from '@shared/parser/taskNoteBody'
import { host } from '../shared/rpc'
import { showToast } from '../shared/stores'
import { addDependency, removeDependency, setDeliverableDates } from '../shared/taskMeta'
import { addDays, diffDays } from './plannerLayout'
import { cascadeShift, type PlannerDeliverable, type PlannerModel } from './plannerSelectors'

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

/**
 * `date`, pulled inside `parent`'s own window if it falls outside it — a work
 * package can never extend before or after the deliverable it belongs to.
 * Clamping each endpoint independently can never invert a span that wasn't
 * already inverted: clamping to a fixed range is monotonic, so `from <= to`
 * going in guarantees `clamp(from) <= clamp(to)` coming out.
 */
function clampToParent(date: string, parent: Pick<PlannerDeliverable, 'start' | 'end'>): string {
  if (date < parent.start) return parent.start
  if (date > parent.end) return parent.end
  return date
}

/**
 * Whole days `d` may shift by without its span leaving `parent`'s window, in
 * either direction — 0 (no parent) means unconstrained. Used for a whole-bar
 * move, which must preserve length rather than clamping each endpoint
 * independently: shifting is a single scalar, so the drag simply stops dead
 * at whichever boundary it reaches first.
 */
function clampShiftToParent(
  d: PlannerDeliverable,
  parent: PlannerDeliverable | undefined,
  days: number
): number {
  if (!parent) return days
  const minDays = diffDays(d.start, parent.start)
  const maxDays = diffDays(d.end, parent.end)
  return Math.max(minDays, Math.min(maxDays, days))
}

/**
 * Move a deliverable by `days`, taking everything that depends on it along.
 * When `id` is a work package, `days` is clamped first so it can never leave
 * its parent's window — the drag simply stops at whichever edge it reaches.
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
  days: number
): Promise<void> {
  const dragged = model.byId.get(id)
  if (!dragged) return
  const parent = dragged.parentId ? model.byId.get(dragged.parentId) : undefined
  const clamped = clampShiftToParent(dragged, parent, days)
  if (clamped === 0) return
  const order = cascadeShift(model, id, clamped)
  let written = 0
  for (const currentId of order) {
    const d = model.byId.get(currentId)
    if (!d) continue
    const [start, end] = spanFor(d, addDays(d.start, clamped), addDays(d.end, clamped))
    const ok = await guarded(
      () => host.replaceLine(d.path, d.line, d.rawLine, setDeliverableDates(d.rawLine, start, end)),
      order.length === 1
        ? 'Note changed on disk — planner refreshed'
        : `${d.label} changed on disk — ${written} of ${order.length} moved; drag again to finish`
    )
    if (!ok) return
    written++
  }
}

/**
 * Change one deliverable's span (an edge drag or a date-picker edit). Moving
 * the *end* later or earlier carries everything downstream along by the same
 * number of days — exactly what `moveDeliverable` does for a whole-bar drag —
 * since a dependent's whole reason for waiting is that end date. Moving the
 * *start* never touches dependents: nothing downstream cares when this one
 * began, only when it finishes.
 *
 * When `d` is a work package, each endpoint is separately clamped into its
 * parent's window afterward — unlike `moveDeliverable`'s shift, a resize is
 * already changing the length, so clamping the far-out endpoint back to the
 * boundary (rather than refusing the whole edit) is the expected "can't go
 * past the edge" feel.
 */
export async function resizeDeliverable(
  model: PlannerModel,
  d: PlannerDeliverable,
  start: string,
  end: string
): Promise<void> {
  let [from, to] = spanFor(d, start, end)
  const parent = d.parentId ? model.byId.get(d.parentId) : undefined
  if (parent) {
    from = clampToParent(from, parent)
    to = clampToParent(to, parent)
  }
  if (from === d.start && to === d.end) return
  const ok = await guarded(
    () => host.replaceLine(d.path, d.line, d.rawLine, setDeliverableDates(d.rawLine, from, to)),
    'Note changed on disk — planner refreshed'
  )
  if (!ok) return
  const days = diffDays(d.end, to)
  if (days === 0) return
  const order = cascadeShift(model, d.id, days).filter((id) => id !== d.id)
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
    if (!depOk) return
    written++
  }
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

/** Set (or clear, with null) a project's target end date. */
export async function setProjectEndDate(
  path: string,
  frontmatter: Record<string, unknown>,
  date: string | null
): Promise<void> {
  const next = { ...frontmatter }
  if (date) next[PROJECT_END_KEY] = date
  else delete next[PROJECT_END_KEY]
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
  const clampedStart = clampToParent(start, parent)
  const clampedEnd = clampToParent(end, parent)
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
