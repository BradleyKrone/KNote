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
 * Move a deliverable by `days`, taking everything that depends on it along.
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
  if (days === 0) return
  const order = cascadeShift(model, id, days)
  let written = 0
  for (const currentId of order) {
    const d = model.byId.get(currentId)
    if (!d) continue
    const [start, end] = spanFor(d, addDays(d.start, days), addDays(d.end, days))
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
 */
export async function resizeDeliverable(
  model: PlannerModel,
  d: PlannerDeliverable,
  start: string,
  end: string
): Promise<void> {
  const [from, to] = spanFor(d, start, end)
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
  return { line: `- [ ] ${name} 🛫 ${start} 📅 ${end} ${deliverableRefMarker(tag)}`, tag }
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
 * Add a task under its deliverable. Anchored on the deliverable's own line —
 * whose exact text we hold — so it's one verified call with no read-then-write
 * race, and the task lands indented as a subtask of the deliverable.
 */
export async function addTask(d: PlannerDeliverable, text: string): Promise<void> {
  await guarded(
    () =>
      host.insertLine(d.path, d.line, d.rawLine, `    - [ ] ${text} ${deliverableRefMarker(d.id)}`),
    'Deliverable changed on disk — planner refreshed'
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
    'Deliverable changed on disk — planner refreshed'
  )
}
