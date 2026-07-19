import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseNote } from '@shared/parser/parseNote'
import { DEFAULT_VAULT_CONFIG, type NoteMeta } from '@shared/types'
import {
  dayHeadingLabel,
  extractDaySection,
  inProgressCards,
  inProgressColumnIndex,
  overdueDeadlines,
  taskStats,
  thisWeekNotePath,
  upcomingDeadlines
} from '@/dashboard/dashboardSelectors'

// Fixed "today" = Wednesday 2026-07-08; the ISO week (Mon–Sun) runs 7/6–7/12.
const TODAY = '2026-07-08'
beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-07-08T09:00:00')))
afterEach(() => vi.useRealTimers())

function buildNotes(): Map<string, NoteMeta> {
  const notes = new Map<string, NoteMeta>()
  notes.set(
    'tasks.md',
    parseNote(
      'tasks.md',
      [
        '- [ ] future task 📅 2026-07-10',
        '- [ ] today task 📅 2026-07-08',
        '- [ ] past task 📅 2026-07-01',
        '- [x] done past 📅 2026-07-02',
        '- [/] in progress 📅 2026-07-09'
      ].join('\n')
    )
  )
  notes.set('ms.md', parseNote('ms.md', ['🏁 Launch 📅 2026-07-15', '🏁 Past event 📅 2026-07-05'].join('\n')))
  notes.set('proj.md', parseNote('proj.md', '---\ndeadline: 2026-07-12\n---\nbody'))
  // A plain `date:` (creation date) in the past must NOT count as a deadline.
  notes.set('made.md', parseNote('made.md', '---\ndate: 2026-06-01\n---\nbody'))
  return notes
}

describe('upcomingDeadlines', () => {
  it('returns tasks, note deadlines, and milestones due today or later, soonest first', () => {
    const items = upcomingDeadlines(buildNotes(), TODAY)
    expect(items.map((i) => `${i.date} ${i.text}`)).toEqual([
      '2026-07-08 today task',
      '2026-07-09 in progress',
      '2026-07-10 future task',
      '2026-07-12 proj',
      '2026-07-15 Launch'
    ])
  })

  it('honors the limit', () => {
    expect(upcomingDeadlines(buildNotes(), TODAY, 2).map((i) => i.text)).toEqual([
      'today task',
      'in progress'
    ])
  })

  it('excludes a plain past `date:` note and done tasks', () => {
    const items = upcomingDeadlines(buildNotes(), TODAY, 50)
    expect(items.some((i) => i.text === 'made')).toBe(false)
    expect(items.some((i) => i.text === 'done past')).toBe(false)
  })
})

describe('overdueDeadlines', () => {
  it('returns only past, not-done tasks and note deadlines — never milestones or plain dates', () => {
    const items = overdueDeadlines(buildNotes(), TODAY)
    expect(items.map((i) => i.text)).toEqual(['past task'])
  })
})

describe('inProgressColumnIndex / inProgressCards', () => {
  it('finds the `/` column in the default config', () => {
    expect(inProgressColumnIndex(DEFAULT_VAULT_CONFIG.columns)).toBe(3)
  })

  it('falls back to a column named …progress… when no `/` char', () => {
    const cols = [
      { name: 'Todo', char: ' ' },
      { name: 'Actively In Progress', char: 'p' }
    ]
    expect(inProgressColumnIndex(cols)).toBe(1)
  })

  it('returns the In Progress cards', () => {
    const cards = inProgressCards(buildNotes(), DEFAULT_VAULT_CONFIG.columns)
    expect(cards.map((c) => c.displayText)).toEqual(['in progress'])
  })
})

describe('taskStats', () => {
  it('counts open/done/overdue and per-column totals', () => {
    const stats = taskStats(buildNotes(), DEFAULT_VAULT_CONFIG.columns, TODAY)
    expect(stats.total).toBe(5)
    expect(stats.done).toBe(1)
    expect(stats.open).toBe(4)
    expect(stats.overdue).toBe(1)
    const count = (name: string): number => stats.columns.find((c) => c.name === name)!.count
    expect(count('To Do')).toBe(3)
    expect(count('In Progress')).toBe(1)
    expect(count('Done')).toBe(1)
  })
})

describe('thisWeekNotePath', () => {
  it('points at the Monday-of-ISO-week note in the weekly folder', () => {
    expect(thisWeekNotePath(DEFAULT_VAULT_CONFIG)).toBe('Weekly/2026-7-6.md')
  })
})

describe('dayHeadingLabel / extractDaySection', () => {
  const content = [
    '# 2026-7-6',
    '',
    '### 7/8/2026 (Wednesday)',
    '- did A',
    '- did B',
    '',
    '### 7/7/2026 (Tuesday)',
    '- did C',
    '',
    '### 7/6/2026 (Monday)'
  ].join('\n')
  const meta = parseNote('Weekly/2026-7-6.md', content)

  it('formats a YYYY-MM-DD date as the M/D/YYYY day-heading label', () => {
    expect(dayHeadingLabel('2026-07-08')).toBe('7/8/2026')
  })

  it("extracts the body under a day's heading up to the next heading", () => {
    expect(extractDaySection(content, meta.headings, '7/8/2026')?.body).toEqual(['- did A', '- did B'])
    expect(extractDaySection(content, meta.headings, '7/7/2026')?.body).toEqual(['- did C'])
  })

  it('returns an empty body for a heading with no content, and null for a missing day', () => {
    expect(extractDaySection(content, meta.headings, '7/6/2026')?.body).toEqual([])
    expect(extractDaySection(content, meta.headings, '7/5/2026')).toBeNull()
  })
})
