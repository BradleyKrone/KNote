import type { NoteMeta, VaultPath } from '@shared/types'
import { DUE_RE, toCard } from '@/board/boardSelectors'

/**
 * Timeline items come from two sources:
 *  - tasks with a due date (`📅 2026-07-15` or `@due(2026-07-15)`)
 *  - notes with a `date:` (or `due:`/`deadline:`) frontmatter property
 */

export interface TimelineItem {
  date: string // YYYY-MM-DD
  kind: 'task' | 'note'
  path: VaultPath
  noteTitle: string
  line: number
  text: string
  done: boolean
  tags: string[]
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

/** All dated items grouped by date, dates sorted ascending. */
export function collectTimelineItems(notes: Map<string, NoteMeta>): Map<string, TimelineItem[]> {
  const byDate = new Map<string, TimelineItem[]>()
  const push = (item: TimelineItem): void => {
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
        tags: meta.tags.map((t) => t.tag)
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
        tags: task.tags
      })
    }
  }

  for (const list of byDate.values()) {
    list.sort((a, b) => Number(a.done) - Number(b.done) || a.text.localeCompare(b.text))
  }
  return new Map([...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])))
}
