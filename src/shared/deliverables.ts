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
        windows.set(tag, { start: start <= end ? start : end, end })
      }
    }
  }
  return windows
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
 * scheduled (has a window) deliverable of a project that isn't closed. Shared
 * by the `@deliverable(...)` autocomplete (host and Live Preview editor) and
 * the right-click "Link to deliverable…" picker, so all three agree on what's
 * offered.
 */
export function liveDeliverables(notes: ReadonlyMap<string, NoteMeta>): DeliverableOption[] {
  const windows = deliverableWindows(notes)
  const closed = closedDeliverableTags(notes)
  const labels = new Map<string, string>()
  for (const meta of notes.values()) {
    if (!isProjectNote(meta)) continue
    for (const task of meta.tasks) {
      if (task.isSubtask) continue
      for (const tag of deliverableTagsOf(task.tags, task.text)) {
        if (windows.has(tag)) labels.set(tag, stripInlineMarkers(task.text) || tag)
      }
    }
  }
  const out: DeliverableOption[] = []
  for (const tag of windows.keys()) {
    if (closed.has(tag)) continue
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
 *  - inside the window → visible;
 *  - past the end and still unchecked → visible, so late work never disappears.
 * Only a task whose deliverables are all either not-yet-started or finished-and-done
 * is hidden.
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
    if (today >= window.start && today <= window.end) return true
    return today > window.end && !isTaskDone(task)
  })
}
