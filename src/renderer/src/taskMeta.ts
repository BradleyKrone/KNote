import { DUE_RE, PRIORITY_RE, TAG_RE } from '@shared/parser/patterns'

/** Collapse whitespace left behind after stripping a marker, and trim. */
function normalize(text: string): string {
  return text.replace(/\s{2,}/g, ' ').trim()
}

/** Append `#tag` to task text if not already present (case-sensitive, exact match). */
export function insertTag(text: string, tag: string): string {
  TAG_RE.lastIndex = 0
  const existing = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(text))) existing.add(m[2])
  if (existing.has(tag)) return text
  return `${normalize(text)} #${tag}`.trim()
}

/** Replace the task's priority marker (0 = none, 1-3 = !/!!/!!!). */
export function setPriority(text: string, level: 0 | 1 | 2 | 3): string {
  const stripped = normalize(text.replace(PRIORITY_RE, ' '))
  return level === 0 ? stripped : `${stripped} ${'!'.repeat(level)}`.trim()
}

/** Replace the task's due date marker, or remove it when `date` is null. */
export function setDueDate(text: string, date: string | null): string {
  const stripped = normalize(text.replace(DUE_RE, ''))
  return date ? `${stripped} 📅 ${date}`.trim() : stripped
}
