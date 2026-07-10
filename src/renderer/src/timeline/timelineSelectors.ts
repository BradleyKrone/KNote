import dayjs from 'dayjs'
import type { NoteMeta, VaultPath } from '@shared/types'
import { DUE_RE, PRIORITY_RE } from '@shared/parser/patterns'
import { stripInlineMarkers, toCard } from '@/board/boardSelectors'

/**
 * Timeline items come from three sources:
 *  - tasks with a due date (`📅 2026-07-15` or `@due(2026-07-15)`)
 *  - notes with a `date:` (or `due:`/`deadline:`) frontmatter property
 *  - 🏁 milestone lines with a due date (never become Kanban cards)
 */

export interface TimelineItem {
  date: string // YYYY-MM-DD
  kind: 'task' | 'note' | 'milestone'
  path: VaultPath
  noteTitle: string
  line: number
  text: string
  done: boolean
  tags: string[]
  /** Milestone marked with a priority marker (!/!!/!!!) — renders larger on the timeline */
  important: boolean
}

function frontmatterDate(meta: NoteMeta): string | null {
  for (const key of ['date', 'due', 'deadline']) {
    const value = meta.frontmatter[key]
    if (value === undefined || value === null) continue
    const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s.trim())
    if (m) return m[1]
  }
  return null
}

export interface TimelineFilters {
  tag: string | null
  text: string
}

function matchesFilters(item: TimelineItem, filters: TimelineFilters): boolean {
  if (filters.tag && !item.tags.some((t) => t === filters.tag || t.startsWith(filters.tag + '/')))
    return false
  if (filters.text) {
    const q = filters.text.toLowerCase()
    if (!item.text.toLowerCase().includes(q) && !item.noteTitle.toLowerCase().includes(q))
      return false
  }
  return true
}

/** All dated items grouped by date, dates sorted ascending. */
export function collectTimelineItems(
  notes: Map<string, NoteMeta>,
  filters: TimelineFilters = { tag: null, text: '' }
): Map<string, TimelineItem[]> {
  const byDate = new Map<string, TimelineItem[]>()
  const push = (item: TimelineItem): void => {
    if (!matchesFilters(item, filters)) return
    const list = byDate.get(item.date) ?? []
    list.push(item)
    byDate.set(item.date, list)
  }

  for (const meta of notes.values()) {
    const noteDate = frontmatterDate(meta)
    if (noteDate) {
      push({
        date: noteDate,
        kind: 'note',
        path: meta.path,
        noteTitle: meta.title,
        line: 0,
        text: meta.title,
        done: false,
        tags: meta.tags.map((t) => t.tag),
        important: false
      })
    }
    for (const task of meta.tasks) {
      const m = DUE_RE.exec(task.text)
      if (!m) continue
      const card = toCard(meta, task)
      push({
        date: m[1] ?? m[2],
        kind: 'task',
        path: meta.path,
        noteTitle: meta.title,
        line: task.line,
        text: card.displayText,
        done: /^[xX]$/.test(task.statusChar),
        tags: task.tags,
        important: false
      })
    }
    for (const milestone of meta.milestones) {
      const m = DUE_RE.exec(milestone.text)
      if (!m) continue
      push({
        date: m[1] ?? m[2],
        kind: 'milestone',
        path: meta.path,
        noteTitle: meta.title,
        line: milestone.line,
        text: stripInlineMarkers(milestone.text),
        done: false,
        tags: milestone.tags,
        important: PRIORITY_RE.test(milestone.text)
      })
    }
  }

  for (const list of byDate.values()) {
    list.sort((a, b) => Number(a.done) - Number(b.done) || a.text.localeCompare(b.text))
  }
  return new Map([...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])))
}

/** All tags present on the (unfiltered) timeline items, for the filter dropdown. */
export function timelineTags(notes: Map<string, NoteMeta>): string[] {
  const tags = new Set<string>()
  for (const list of collectTimelineItems(notes).values()) {
    for (const item of list) for (const t of item.tags) tags.add(t)
  }
  return [...tags].sort()
}

/** Human countdown/countup label for a YYYY-MM-DD date relative to today, tiered by magnitude. */
export function formatTimeUntil(date: string, today: string): string {
  const days = dayjs(date).diff(dayjs(today), 'day')
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'

  const ago = days < 0
  const n = Math.abs(days)
  let amount: number
  let unit: string
  if (n >= 30) {
    amount = Math.round(n / 30)
    unit = amount === 1 ? 'month' : 'months'
  } else if (n >= 7) {
    amount = Math.round(n / 7)
    unit = amount === 1 ? 'week' : 'weeks'
  } else {
    amount = n
    unit = amount === 1 ? 'day' : 'days'
  }
  return ago ? `${amount} ${unit} ago` : `in ${amount} ${unit}`
}
