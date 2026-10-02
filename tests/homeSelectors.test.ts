import { describe, expect, it } from 'vitest'
import {
  daysSince,
  dueBuckets,
  inProgressCards,
  inProgressColumn,
  spanInWindow,
  upcomingPlanner
} from '@/home/homeSelectors'
import { parseNote } from '@shared/parser/parseNote'
import { DEFAULT_VAULT_CONFIG, type NoteMeta } from '@shared/types'

const TODAY = '2026-10-01'

function vault(files: Record<string, string>): Map<string, NoteMeta> {
  const notes = new Map<string, NoteMeta>()
  for (const [path, content] of Object.entries(files)) notes.set(path, parseNote(path, content))
  return notes
}

describe('inProgressColumn', () => {
  it('finds the column by its / char, then by name', () => {
    expect(inProgressColumn(DEFAULT_VAULT_CONFIG.columns)).toBe(3)
    expect(
      inProgressColumn([
        { name: 'Todo', char: ' ' },
        { name: 'Work in progress', char: 'p' }
      ])
    ).toBe(1)
    expect(inProgressColumn([{ name: 'Todo', char: ' ' }])).toBe(-1)
  })
})

describe('inProgressCards', () => {
  it('lists only In Progress @task cards, highest priority first', () => {
    const notes = vault({
      'a.md': [
        '- [/] @task low',
        '- [/] @task urgent !!!',
        '- [ ] @task not started',
        '- [/] plain checkbox, not a card',
        '- [x] @task done'
      ].join('\n')
    })
    const cards = inProgressCards(notes, DEFAULT_VAULT_CONFIG, [])
    expect(cards.map((c) => c.displayText)).toEqual(['urgent', 'low'])
  })

  it('respects renamed columns', () => {
    const notes = vault({ 'a.md': '- [p] @task doing it\n- [/] @task other' })
    const config = {
      ...DEFAULT_VAULT_CONFIG,
      columns: [
        { name: 'Todo', char: ' ' },
        { name: 'In progress', char: 'p' },
        { name: 'Done', char: 'x' }
      ]
    }
    expect(inProgressCards(notes, config, []).map((c) => c.displayText)).toEqual(['doing it'])
  })

  it('honors the board’s hidden roots', () => {
    const notes = vault({ 'm/a.md': '- [/] @task in a mount' })
    const config = { ...DEFAULT_VAULT_CONFIG, boardHiddenRoots: ['m'] }
    expect(inProgressCards(notes, config, ['m'])).toEqual([])
  })
})

describe('daysSince', () => {
  it('counts whole days from a Status Changed stamp', () => {
    expect(daysSince('9/28/2026', TODAY)).toBe(3)
    expect(daysSince('10/1/2026', TODAY)).toBe(0)
    expect(daysSince(null, TODAY)).toBeNull()
    expect(daysSince('n/a', TODAY)).toBeNull()
  })
})

describe('dueBuckets', () => {
  it('buckets open cards by urgency and skips done/archived/undated ones', () => {
    const notes = vault({
      'a.md': [
        '- [ ] @task late 📅 2026-09-29',
        '- [/] @task now 📅 2026-10-01',
        '- [ ] @task soon 📅 2026-10-05',
        '- [ ] @task far 📅 2026-11-30',
        '- [x] @task finished 📅 2026-09-20',
        '- [a] @task archived 📅 2026-09-20',
        '- [ ] @task undated'
      ].join('\n')
    })
    const b = dueBuckets(notes, DEFAULT_VAULT_CONFIG, [], TODAY)
    expect(b.overdue.map((c) => c.displayText)).toEqual(['late'])
    expect(b.today.map((c) => c.displayText)).toEqual(['now'])
    expect(b.soon.map((c) => c.displayText)).toEqual(['soon'])
    expect(b.followUps).toEqual([])
  })

  it('collects Waiting cards whose follow-up has come due', () => {
    const notes = vault({
      'a.md': [
        '- [w] @task chase vendor',
        '  Reason for Waiting: parts ⏳ 2026-09-30',
        '- [w] @task later',
        '  Reason for Waiting: not yet ⏳ 2026-10-20'
      ].join('\n')
    })
    const b = dueBuckets(notes, DEFAULT_VAULT_CONFIG, [], TODAY)
    expect(b.followUps.map((c) => c.displayText)).toEqual(['chase vendor'])
  })
})

const PROJECT = [
  '---',
  'type: project',
  'project: alpha',
  '---',
  '',
  '- [ ] @task Late 🛫 2026-09-01 📅 2026-09-20 @deliverable(alpha/late)',
  '- [ ] @task Current 🛫 2026-09-25 📅 2026-10-10 @deliverable(alpha/current)',
  '- [ ] @task Chunk 🛫 2026-09-26 📅 2026-10-03 @deliverable(alpha/chunk) @parent(current)',
  '- [ ] @task Future 🛫 2026-10-20 📅 2026-11-01 @deliverable(alpha/future)',
  '- [ ] @task Way out 🛫 2027-01-01 📅 2027-02-01 @deliverable(alpha/way-out)',
  '- [x] @task Shipped 🛫 2026-09-01 📅 2026-09-10 @deliverable(alpha/shipped)',
  '🏁 Kickoff 📅 2026-10-04',
  '🏁 Review !! 📅 2026-10-08 @deliverable(alpha/current)',
  '🏁 Long gone 📅 2026-08-01',
  ''
].join('\n')

describe('upcomingPlanner', () => {
  it('splits overdue from upcoming, includes work packages, and drops done/far-out ones', () => {
    const up = upcomingPlanner(vault({ 'Alpha.md': PROJECT }), [], TODAY)
    expect(up.overdue.map((d) => d.label)).toEqual(['Late'])
    expect(up.deliverables.map((d) => d.label)).toEqual(['Chunk', 'Current', 'Future'])
    expect(up.deliverables.find((d) => d.label === 'Chunk')?.parentLabel).toBe('Current')
    expect(up.milestones.map((m) => [m.label, m.important])).toEqual([
      ['Kickoff', false],
      ['Review', true]
    ])
  })

  it('leaves out projects hidden from the planner, and completed projects', () => {
    expect(upcomingPlanner(vault({ 'Alpha.md': PROJECT }), ['alpha'], TODAY).deliverables).toEqual(
      []
    )
    const done = PROJECT.replace('project: alpha', 'project: alpha\nstatus: completed')
    expect(upcomingPlanner(vault({ 'Alpha.md': done }), [], TODAY).deliverables).toEqual([])
  })
})

describe('spanInWindow', () => {
  it('clips a span to the window, as fractions', () => {
    expect(spanInWindow('2026-10-01', '2026-10-01', '2026-10-01', 10)).toEqual({
      left: 0,
      width: 0.1
    })
    expect(spanInWindow('2026-09-01', '2026-10-02', '2026-10-01', 10)).toEqual({
      left: 0,
      width: 0.2
    })
    expect(spanInWindow('2026-10-09', '2026-12-01', '2026-10-01', 10)).toEqual({
      left: 0.8,
      width: 0.2
    })
    expect(spanInWindow('2026-09-01', '2026-09-30', '2026-10-01', 10)).toBeNull()
    expect(spanInWindow('2026-10-11', '2026-10-12', '2026-10-01', 10)).toBeNull()
  })
})
