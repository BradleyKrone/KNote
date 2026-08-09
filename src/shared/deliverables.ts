/**
 * The one definition of "what dates does this deliverable span", shared by the
 * planner (which draws the bars) and the Kanban board (which hides a
 * deliverable's tasks while it isn't current). It lives in `shared/` precisely
 * so the board never has to import planner code to agree with it.
 *
 * A deliverable is a *top-level* checkbox task in a note whose frontmatter says
 * `type: project`, carrying its own `@deliverable(<project>/<name>)` marker
 * plus a `🛫 start` / `📅 end` span. An ordinary task or milestone *joins* one
 * by carrying that same marker anywhere else in the vault — the same syntax
 * either way, deliberately not a `#tag`, so a deliverable never clutters the
 * Tags tree, `#` autocomplete, or a generic tag pill. What makes one line
 * *defining* rather than a member is purely structural (top-level, in the
 * project's own note, carrying a span), never the marker itself — see
 * `deliverableTagsOf` below. Notes written before this switch may still carry
 * a defining line's identity as a literal `#deliverable/…` tag instead; that
 * legacy form still reads (`deliverableTagsOf` recognizes both), but nothing
 * writes it any more.
 */

import type { NoteMeta, TaskItem } from './types'
import {
  ARCHIVED_CHAR,
  DELIVERABLE_REF_RE,
  DELIVERABLE_TAG_RE,
  DEPENDS_RE,
  DUE_RE,
  START_RE,
  dependsTag,
  parseDeliverableTag,
  stripInlineMarkers
} from './parser/patterns'

export interface DeliverableWindow {
  /** YYYY-MM-DD — falls back to the end date when the line carries no `🛫`. */
  start: string
  /** YYYY-MM-DD */
  end: string
  /** Whether the defining line's own checkbox is checked. */
  done: boolean
}

/**
 * The board's "which project/deliverable am I looking at" filter, picked from
 * the Boards sidebar tree. `label` is display-only (the tree already knows the
 * project/deliverable's human title); matching only ever looks at `slug`/`tag`.
 * `null` is the resting "no filter" state, same as `{ kind: 'all' }`.
 */
export type DeliverableScopeFilter =
  | { kind: 'all' }
  | { kind: 'unassigned' }
  | { kind: 'project'; slug: string; label: string }
  | { kind: 'deliverable'; tag: string; label: string }
  | null

/** True when the note's frontmatter marks it a project note. */
export function isProjectNote(meta: NoteMeta): boolean {
  return String(meta.frontmatter['type'] ?? '').trim() === 'project'
}

/** A project's slug: its `project:` frontmatter, or its title kebab-cased. */
export function projectSlug(meta: NoteMeta): string {
  const raw = meta.frontmatter['project']
  const value = raw == null ? '' : String(raw).trim()
  return value || slugify(meta.title)
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  )
}

/** Frontmatter key a project's completion flag lives under. */
export const PROJECT_STATUS_KEY = 'status'
/** Frontmatter key a project's target end date lives under. */
export const PROJECT_END_KEY = 'end'

/**
 * True when the project note is marked finished (`status: completed`).
 *
 * A completed project is closed for business: the planner won't let you add
 * deliverables or tasks to it, and its deliverables drop out of `@deliverable(…)`
 * completion so old work can't be joined onto it by accident. `complete`,
 * `done` and `finished` all read as completed too — this is a value someone
 * types by hand, and refusing a synonym would just look broken.
 */
export function isProjectComplete(meta: NoteMeta): boolean {
  const raw = meta.frontmatter[PROJECT_STATUS_KEY]
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
  return value === 'completed' || value === 'complete' || value === 'done' || value === 'finished'
}

/** A YYYY-MM-DD date out of a frontmatter value (a real `Date` or a string). */
export function frontmatterDate(value: unknown): string | null {
  if (value == null) return null
  const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s.trim())
  return m ? m[1] : null
}

/**
 * A project's own target end date (`end:` frontmatter, `due:`/`deadline:` also
 * read). Null when it hasn't been given one — the planner then falls back to
 * the latest deliverable end, which is a *derived* finish rather than a
 * commitment, and so is never reported as overdue.
 */
export function projectEndDate(meta: NoteMeta): string | null {
  for (const key of [PROJECT_END_KEY, 'due', 'deadline']) {
    const date = frontmatterDate(meta.frontmatter[key])
    if (date) return date
  }
  return null
}

/** The `📅`/`@due(...)` date on a line's text, or null. */
export function endDateOf(text: string): string | null {
  const m = DUE_RE.exec(text)
  return m ? (m[1] ?? m[2]) : null
}

/** The `🛫`/`@start(...)` date on a line's text, or null. */
export function startDateOf(text: string): string | null {
  const m = START_RE.exec(text)
  return m ? (m[1] ?? m[2]) : null
}

/**
 * The deliverable(s) a line *joins* via `@deliverable(<project>/<name>)`,
 * read straight off its text (the marker is never a `#tag`, so it can't be
 * found in a task's `tags` array). Returns bare `deliverable/<project>/<name>`
 * strings, the same format `DELIVERABLE_TAG_RE` produces.
 *
 * A `⛓ @deliverable(...)` dependency is text-identical to a join marker
 * except for its `⛓ ` prefix, so any `DELIVERABLE_REF_RE` match that falls
 * inside a `DEPENDS_RE` span is excluded here — otherwise a deliverable would
 * "join" (and a task's dependency would count as membership in) every
 * deliverable it merely waits on.
 */
export function deliverableRefsOf(text: string): string[] {
  const dependencySpans = [...text.matchAll(DEPENDS_RE)].map(
    (m) => [m.index ?? 0, (m.index ?? 0) + m[0].length] as const
  )
  const inDependency = (i: number): boolean =>
    dependencySpans.some(([from, to]) => i >= from && i < to)
  return [...text.matchAll(DELIVERABLE_REF_RE)]
    .filter((m) => !inDependency(m.index ?? 0))
    .map((m) => `deliverable/${m[1]}/${m[2]}`)
}

/**
 * The deliverable tags (bare, no `#`) a line *belongs to* — combining the
 * current `@deliverable(...)` marker (read off the text) with a legacy
 * `#deliverable/…` tag (read off the indexed `tags` array), so a note written
 * before the switch to `@` keeps working unchanged.
 *
 * A `⛓ …` dependency marker referencing another deliverable is subtracted
 * from the legacy tag set: when written the old way (`⛓ #deliverable/…`) it's
 * a `#tag` as far as the indexer is concerned, and without this a deliverable
 * would join every deliverable it merely waits on, and would redefine their
 * windows with its own dates. The current `⛓ @deliverable(...)` form never
 * enters the `tags` array in the first place, so it needs no such filtering.
 *
 * This is the one function every lookup should call, whether it's asking
 * "does this line define a deliverable" or "does this line belong to one" —
 * the two questions differ only in the structural filters each caller already
 * applies (top-level task, project note, has a span), never in which marker
 * was used to say so.
 */
export function deliverableTagsOf(tags: readonly string[], text = ''): string[] {
  const depends = new Set([...text.matchAll(DEPENDS_RE)].map(dependsTag))
  const legacy = tags.filter((t) => DELIVERABLE_TAG_RE.test(t) && !depends.has(t))
  return [...new Set([...legacy, ...deliverableRefsOf(text)])]
}

/** Alias for `deliverableTagsOf` — reads better at a *membership* call site (a task/milestone asking which deliverables it belongs to) than at a *defining* one. */
export function deliverableMembershipOf(tags: readonly string[], text = ''): string[] {
  return deliverableTagsOf(tags, text)
}

/** Bare `deliverable/<project>/<name>` tag this line defines, or null. A
 *  defining line is a top-level task, in a `type: project` note, carrying
 *  `@deliverable(...)` for that note's own project — same rule as
 *  `deliverableTagsOf`, just narrowed to "this note". `requireSpan` additionally
 *  demands the `📅`/`@due(...)` end date `deliverableWindows()` requires before
 *  it'll schedule the tag at all (`🛫`/start is optional, same as there) — pass
 *  `true` wherever "defining" needs to mean "this is *the* entry", `false`
 *  where a not-yet-dated task should still count as one in progress (e.g. the
 *  editor's right-click menu, which offers "Set start/due date" precisely for
 *  a line that hasn't been dated yet). */
export function definingDeliverableTag(
  text: string,
  isTopLevelTask: boolean,
  meta: NoteMeta | undefined,
  requireSpan = false
): string | null {
  if (!isTopLevelTask || !meta || !isProjectNote(meta)) return null
  if (requireSpan && !endDateOf(text)) return null
  const slug = projectSlug(meta)
  return deliverableRefsOf(text).find((t) => parseDeliverableTag(t)?.project === slug) ?? null
}

/** Bare `deliverable/<project>/<name>` tag → the `@deliverable(project/name)` text a task/milestone joins it with. */
export function deliverableRefMarker(tag: string): string {
  const parsed = parseDeliverableTag(tag)
  if (!parsed) throw new Error(`not a deliverable tag: ${tag}`)
  return `@deliverable(${parsed.project}/${parsed.deliverable})`
}

/** A task counts as done when checked or archived. */
export function isTaskDone(task: Pick<TaskItem, 'statusChar'>): boolean {
  return /^[xX]$/.test(task.statusChar) || task.statusChar === ARCHIVED_CHAR
}

export interface DeliverableProgress {
  done: number
  total: number
}

/**
 * Every deliverable's member-task completion, keyed by its bare tag — the
 * Kanban board's "N of M tasks done" readout on a deliverable's own card.
 * Counts every task anywhere in the vault carrying the tag, excluding the
 * defining line itself (same exclusion `buildPlannerModel`'s member pass
 * makes), mirroring the planner's `percentComplete` ratio (task-only; a
 * deliverable's milestones don't count toward it there either).
 */
export function deliverableProgress(
  notes: ReadonlyMap<string, NoteMeta>
): Map<string, DeliverableProgress> {
  const progress = new Map<string, DeliverableProgress>()
  for (const meta of notes.values()) {
    for (const task of meta.tasks) {
      for (const tag of deliverableMembershipOf(task.tags, task.text)) {
        if (definingDeliverableTag(task.text, !task.isSubtask, meta, true) === tag) continue
        const entry = progress.get(tag) ?? { done: 0, total: 0 }
        entry.total++
        if (isTaskDone(task)) entry.done++
        progress.set(tag, entry)
      }
    }
  }
  return progress
}

/**
 * Every deliverable's date window, keyed by its bare tag
 * (`deliverable/govalle/design`). Only top-level tasks in project notes define
 * a window — a tagged task elsewhere is a *member*, never a definition, so a
 * stray tag can't silently redefine the schedule. A deliverable with no `📅`
 * end date has no window and is skipped: it can't be scheduled yet.
 */
export function deliverableWindows(
  notes: ReadonlyMap<string, NoteMeta>
): Map<string, DeliverableWindow> {
  const windows = new Map<string, DeliverableWindow>()
  for (const meta of notes.values()) {
    if (!isProjectNote(meta)) continue
    for (const task of meta.tasks) {
      if (task.isSubtask) continue
      const end = endDateOf(task.text)
      if (!end) continue
      const start = startDateOf(task.text) ?? end
      for (const tag of deliverableTagsOf(task.tags, task.text)) {
        if (!parseDeliverableTag(tag)) continue
        windows.set(tag, { start: start <= end ? start : end, end, done: isTaskDone(task) })
      }
    }
  }
  return windows
}

/**
 * Bare deliverable tags whose window has closed with work still open — a
 * deliverable-level echo of the planner's project-overdue rule (past its
 * date, unfinished), but keyed by tag so the board can flag a *member* task
 * as overdue even when that task carries no `@due()` of its own. Completion
 * is its member tasks' done ratio when it has any, else its own checkbox —
 * the same fallback `percentComplete` uses in the planner, kept here too so
 * board and planner never disagree about whether a deliverable is late.
 */
export function overdueDeliverables(
  notes: ReadonlyMap<string, NoteMeta>,
  today: string
): Set<string> {
  const windows = deliverableWindows(notes)
  const progress = deliverableProgress(notes)
  const overdue = new Set<string>()
  for (const [tag, window] of windows) {
    if (today <= window.end) continue
    const p = progress.get(tag)
    const done = p && p.total > 0 ? p.done === p.total : window.done
    if (!done) overdue.add(tag)
  }
  return overdue
}

/**
 * Every `deliverable/…` tag that belongs to a completed project — the set the
 * `@deliverable(…)` completion list filters out, so a finished project stops
 * being an option the moment it's closed. Deliverables of *live* projects are
 * never in here, and neither is any other tag.
 */
export function closedDeliverableTags(notes: ReadonlyMap<string, NoteMeta>): Set<string> {
  const closed = new Set<string>()
  for (const meta of notes.values()) {
    if (!isProjectNote(meta) || !isProjectComplete(meta)) continue
    const slug = projectSlug(meta)
    for (const task of meta.tasks) {
      for (const tag of deliverableTagsOf(task.tags, task.text)) {
        if (parseDeliverableTag(tag)?.project === slug) closed.add(tag)
      }
    }
  }
  return closed
}

/** One scheduled, open deliverable — what a `@deliverable(...)` picker offers to join. */
export interface DeliverableOption {
  /** Bare `deliverable/<project>/<name>` tag. */
  tag: string
  project: string
  deliverable: string
  /** The defining task's own text, or `project/name` when that can't be found. */
  label: string
}

/**
 * Every deliverable a task or milestone could join right now — every
 * scheduled (has a window) deliverable of a project that isn't closed, and
 * whose own defining checkbox isn't already done. Shared by the
 * `@deliverable(...)` autocomplete (host and Live Preview editor) and the
 * right-click "Link to deliverable…" picker, so all three agree on what's
 * offered.
 */
export function liveDeliverables(notes: ReadonlyMap<string, NoteMeta>): DeliverableOption[] {
  const windows = deliverableWindows(notes)
  const closed = closedDeliverableTags(notes)
  const labels = new Map<string, string>()
  for (const meta of notes.values()) {
    if (!isProjectNote(meta)) continue
    for (const task of meta.tasks) {
      // Same defining criteria as deliverableWindows above (top-level, own span) —
      // a task that only *joins* the deliverable must never supply its label.
      if (task.isSubtask || !endDateOf(task.text)) continue
      for (const tag of deliverableTagsOf(task.tags, task.text)) {
        if (windows.has(tag)) labels.set(tag, stripInlineMarkers(task.text) || tag)
      }
    }
  }
  const out: DeliverableOption[] = []
  for (const [tag, window] of windows) {
    if (closed.has(tag) || window.done) continue
    const parsed = parseDeliverableTag(tag)
    if (!parsed) continue
    out.push({
      tag,
      project: parsed.project,
      deliverable: parsed.deliverable,
      label: labels.get(tag) ?? `${parsed.project}/${parsed.deliverable}`
    })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Whether a task should be visible on the board today, given the deliverable
 * windows. The bias is always toward showing work:
 *  - no deliverable tag → unaffected, always visible;
 *  - a tag with no known window (typo, or a deliverable not scheduled yet) →
 *    visible, because silently hiding real work is far worse than showing it;
 *  - on or after the window's start → visible, whether it's still open, past
 *    its end date, or already checked off. Completion is never a visibility
 *    signal here — a finished task/deliverable stays on the board like any
 *    other until it's explicitly archived (`ARCHIVED_CHAR`, checked
 *    elsewhere), so "done" reads as a column move, not a disappearance.
 * Only a task whose deliverables have *all* not started yet is hidden — that's
 * the one case this exists for: keeping future-scheduled work off the board
 * until it's actually current.
 */
export function visibleForDeliverable(
  task: Pick<TaskItem, 'statusChar' | 'tags'> & { text?: string },
  windows: ReadonlyMap<string, DeliverableWindow>,
  today: string
): boolean {
  const tags = deliverableMembershipOf(task.tags, task.text ?? '')
  if (tags.length === 0) return true
  return tags.some((tag) => {
    const window = windows.get(tag)
    if (!window) return true
    return today >= window.start
  })
}
