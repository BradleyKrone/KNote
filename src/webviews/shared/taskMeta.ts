import { DUE_RE, preservingBlockId, PRIORITY_RE, TAG_RE } from '@shared/parser/patterns'

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
