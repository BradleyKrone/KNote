import { describe, expect, it } from 'vitest'
import { findPreviousDay, weeklyPathFor } from '@shared/previousDay'
import { parseNote } from '@shared/parser/parseNote'
import type { NoteMeta } from '@shared/types'

const CONFIG = { weeklyFolder: 'Weekly', weeklyFormat: 'YYYY-M-D' }

/** A weekly note in weekdaysBlock's shape, with `days` filling some day sections. */
function week(monday: string, days: Record<string, string>): string {
  const lines = [`# ${monday}`, '', '## Tasks', '', '## Notes', '']
  const start = new Date(monday + 'T00:00:00')
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const label = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
    lines.push(`### ${label} (${names[i]})`, '')
    if (days[label]) lines.push(days[label], '')
  }
  return lines.join('\n')
}

function vault(files: Record<string, string>): {
  notes: Map<string, NoteMeta>
  contentOf: (p: string) => string | undefined
} {
  const notes = new Map<string, NoteMeta>()
  for (const [path, content] of Object.entries(files)) notes.set(path, parseNote(path, content))
  return { notes, contentOf: (p) => files[p] }
}

describe('weeklyPathFor', () => {
  it('names the note after the ISO week’s Monday', () => {
    expect(weeklyPathFor('2026-10-01', CONFIG)).toBe('Weekly/2026-9-28.md')
    expect(weeklyPathFor('2026-10-04', CONFIG)).toBe('Weekly/2026-9-28.md')
    expect(weeklyPathFor('2026-10-05', CONFIG)).toBe('Weekly/2026-10-5.md')
  })

  it('honors a custom format and folder', () => {
    expect(
      weeklyPathFor('2026-10-01', { weeklyFolder: 'Journal/W', weeklyFormat: 'YYYY-MM-DD' })
    ).toBe('Journal/W/2026-09-28.md')
  })
})

describe('findPreviousDay', () => {
  it('returns yesterday’s section, heading excluded', () => {
    const { notes, contentOf } = vault({
      'Weekly/2026-9-28.md': week('2026-09-28', {
        '9/30/2026': '- shipped the thing\n- met with [[Ana]]'
      })
    })
    const day = findPreviousDay(notes, contentOf, CONFIG, '2026-10-01')
    expect(day).toMatchObject({
      date: '2026-09-30',
      path: 'Weekly/2026-9-28.md',
      content: '- shipped the thing\n- met with [[Ana]]'
    })
    expect(contentOf('Weekly/2026-9-28.md')!.split('\n')[day!.line]).toBe(
      '### 9/30/2026 (Wednesday)'
    )
  })

  it('skips empty days back to the last one with something written', () => {
    const { notes, contentOf } = vault({
      'Weekly/2026-9-28.md': week('2026-09-28', { '9/28/2026': 'monday notes' })
    })
    expect(findPreviousDay(notes, contentOf, CONFIG, '2026-10-01')?.date).toBe('2026-09-28')
  })

  it('crosses into last week’s note on a Monday', () => {
    const { notes, contentOf } = vault({
      'Weekly/2026-9-21.md': week('2026-09-21', { '9/25/2026': 'friday wrap-up' }),
      'Weekly/2026-9-28.md': week('2026-09-28', {})
    })
    expect(findPreviousDay(notes, contentOf, CONFIG, '2026-09-28')).toMatchObject({
      date: '2026-09-25',
      path: 'Weekly/2026-9-21.md',
      content: 'friday wrap-up'
    })
  })

  it('keeps nested subheadings but stops at the next day', () => {
    const { notes, contentOf } = vault({
      'Weekly/2026-9-28.md': week('2026-09-28', { '9/29/2026': '#### Standup\n- fine' })
    })
    expect(findPreviousDay(notes, contentOf, CONFIG, '2026-09-30')?.content).toBe(
      '#### Standup\n- fine'
    )
  })

  it('never returns today', () => {
    const { notes, contentOf } = vault({
      'Weekly/2026-9-28.md': week('2026-09-28', { '10/1/2026': 'today' })
    })
    expect(findPreviousDay(notes, contentOf, CONFIG, '2026-10-01')).toBeNull()
  })

  it('is null without weekly notes, or with nothing in the last two weeks', () => {
    expect(findPreviousDay(new Map(), () => undefined, CONFIG, '2026-10-01')).toBeNull()
    const { notes, contentOf } = vault({
      'Weekly/2026-9-7.md': week('2026-09-07', { '9/8/2026': 'too old' })
    })
    expect(findPreviousDay(notes, contentOf, CONFIG, '2026-10-01')).toBeNull()
  })

  it('does not mistake 9/3 for 9/30', () => {
    const { notes, contentOf } = vault({
      'Weekly/2026-9-28.md': week('2026-09-28', { '9/30/2026': 'the 30th' })
    })
    // 9/3 is in an older week with no note; must not match the 9/30 heading.
    expect(findPreviousDay(notes, contentOf, CONFIG, '2026-09-04')).toBeNull()
  })
})
