import {
  DEPENDS_RE,
  DUE_RE,
  dependsTag,
  preservingBlockId,
  PRIORITY_RE,
  START_RE,
  TAG_RE
} from '@shared/parser/patterns'
import { deliverableRefMarker, deliverableRefsOf } from '@shared/deliverables'

/** Display label for a priority level (0 = none), shared by the board card,
 *  the priority picker, and the editor's live-preview pill. */
export const PRIORITY_LABELS: readonly string[] = ['', 'Low', 'Medium', 'High']

/** Collapse whitespace left behind after stripping a marker, and trim. */
function normalize(text: string): string {
  return text.replace(/\s{2,}/g, ' ').trim()
}

// Each setter appends its marker to the end of the line, so all three run
// inside preservingBlockId — otherwise they'd bury a task's `^anchor` mid-line,
// which unlinks it (see BLOCK_ID_RE).

/** Append `#tag` to task text if not already present (case-sensitive, exact match). */
export function insertTag(text: string, tag: string): string {
  return preservingBlockId(text, (t) => {
    TAG_RE.lastIndex = 0
    const existing = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = TAG_RE.exec(t))) existing.add(m[2])
    if (existing.has(tag)) return t
    return `${normalize(t)} #${tag}`.trim()
  })
}

/** Append an `@deliverable(project/name)` join marker if not already present; idempotent. */
export function insertDeliverableRef(text: string, tag: string): string {
  return preservingBlockId(text, (t) => {
    if (deliverableRefsOf(t).includes(tag)) return t
    return `${normalize(t)} ${deliverableRefMarker(tag)}`.trim()
  })
}

/** Replace the task's priority marker (0 = none, 1-3 = !/!!/!!!). */
export function setPriority(text: string, level: 0 | 1 | 2 | 3): string {
  return preservingBlockId(text, (t) => {
    const stripped = normalize(t.replace(PRIORITY_RE, ' '))
    return level === 0 ? stripped : `${stripped} ${'!'.repeat(level)}`.trim()
  })
}

/** Replace the task's due date marker, or remove it when `date` is null. */
export function setDueDate(text: string, date: string | null): string {
  return preservingBlockId(text, (t) => {
    const stripped = normalize(t.replace(DUE_RE, ''))
    return date ? `${stripped} 📅 ${date}`.trim() : stripped
  })
}

/** Replace the task's 🛫 start-date marker, or remove it when `date` is null. */
export function setStartDate(text: string, date: string | null): string {
  return preservingBlockId(text, (t) => {
    const stripped = normalize(t.replace(START_RE, ''))
    return date ? `${stripped} 🛫 ${date}`.trim() : stripped
  })
}

/**
 * Set both halves of a deliverable's span in one pass, so moving or resizing a
 * bar is a single line rewrite rather than two verified edits (the second of
 * which would be racing the first's index delta). Emits `🛫` before `📅`.
 */
export function setDeliverableDates(text: string, start: string, end: string): string {
  return preservingBlockId(text, (t) => {
    const stripped = normalize(t.replace(START_RE, '').replace(DUE_RE, ''))
    return `${stripped} 🛫 ${start} 📅 ${end}`.trim()
  })
}

/** Append a `⛓ @deliverable(project/name)` dependency marker; idempotent. */
export function addDependency(text: string, predecessorTag: string): string {
  if (dependencies(text).includes(predecessorTag)) return text
  return preservingBlockId(text, (t) =>
    `${normalize(t)} ⛓ ${deliverableRefMarker(predecessorTag)}`.trim()
  )
}

/**
 * Remove one dependency marker naming `predecessorTag`, leaving any others —
 * whichever form it was written in (current `⛓ @deliverable(...)`, or a
 * legacy `⛓ #deliverable/...`).
 */
export function removeDependency(text: string, predecessorTag: string): string {
  return preservingBlockId(text, (t) =>
    normalize(
      t.replace(
        DEPENDS_RE,
        (
          match,
          legacy: string | undefined,
          project: string | undefined,
          name: string | undefined
        ) => ((legacy ?? `deliverable/${project}/${name}`) === predecessorTag ? '' : match)
      )
    )
  )
}

/** The predecessor tags a line declares (bare, no `#`), whichever marker form each was written in. */
export function dependencies(text: string): string[] {
  return [...text.matchAll(DEPENDS_RE)].map(dependsTag)
}
