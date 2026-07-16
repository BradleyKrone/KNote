import { describe, expect, it } from 'vitest'
import type { MachineDef, NoteMeta } from '@shared/types'
import { parseNote } from '@shared/parser/parseNote'
import {
  collectBoards,
  collectMachines,
  collectMilestones,
  relativeLabel
} from '@ext/trees/quickAccessSelectors'

/** Build a notes Map by parsing each [path, content] pair (mtime fixed for determinism). */
function vault(...files: Array<[string, string]>): Map<string, NoteMeta> {
  const notes = new Map<string, NoteMeta>()
  for (const [path, content] of files) notes.set(path, parseNote(path, content, 1_700_000_000_000))
  return notes
}

describe('collectBoards', () => {
  it('counts open vs total per note and totals the vault', () => {
    const notes = vault(['a.md', '- [ ] one\n- [/] two\n- [x] three'], ['b.md', '- [ ] only open'])
    const model = collectBoards(notes)
    expect(model).toMatchObject({ open: 3, total: 4 })
    expect(model.notes).toEqual([
      { kind: 'note', path: 'a.md', title: 'a', open: 2, total: 3 },
      { kind: 'note', path: 'b.md', title: 'b', open: 1, total: 1 }
    ])
  })

  it('excludes archived tasks and subtasks, matching the board', () => {
    const notes = vault(['a.md', '- [ ] parent\n  - [ ] child subtask\n- [a] archived'])
    const model = collectBoards(notes)
    // Only "parent" is a card: the subtask is nested, the archived one is [a].
    expect(model).toMatchObject({ open: 1, total: 1 })
    expect(model.notes).toEqual([{ kind: 'note', path: 'a.md', title: 'a', open: 1, total: 1 }])
  })

  it('omits notes with no board cards entirely', () => {
    const notes = vault(['a.md', '- [ ] task'], ['prose.md', 'just words, no checkboxes'])
    expect(collectBoards(notes).notes.map((n) => n.path)).toEqual(['a.md'])
  })

  it('treats [X] as done the same as [x]', () => {
    const notes = vault(['a.md', '- [X] shouty done'])
    expect(collectBoards(notes)).toMatchObject({ open: 0, total: 1 })
  })

  it('sorts by open count desc, then title, so live boards float to the top', () => {
    const notes = vault(
      ['quiet.md', '- [x] done'],
      ['busy.md', '- [ ] a\n- [ ] b\n- [ ] c'],
      ['zeta.md', '- [ ] one'],
      ['alpha.md', '- [ ] one']
    )
    expect(collectBoards(notes).notes.map((n) => n.title)).toEqual([
      'busy',
      'alpha',
      'zeta',
      'quiet'
    ])
  })
})

describe('collectMachines', () => {
  const registry: MachineDef[] = [
    { serial: 'Z6A00101', model: 'D6', attributes: ['LGP'] },
    { serial: 'Z6A00202', model: 'D8', attributes: [] }
  ]

  it('groups entries under their serial and strips inline markers from the label', () => {
    const notes = vault(['log.md', '🚜 Z6A00101 replaced the final drive #repair 📅 2026-07-10'])
    const { machines, totalEntries } = collectMachines(notes, registry)
    expect(totalEntries).toBe(1)
    const z101 = machines.find((m) => m.serial === 'Z6A00101')!
    expect(z101.entries).toEqual([
      {
        kind: 'entry',
        path: 'log.md',
        noteTitle: 'log',
        line: 0,
        text: 'replaced the final drive',
        date: '2026-07-10'
      }
    ])
  })

  it('keeps registry order, formats config, and lists registered machines with no entries', () => {
    const { machines } = collectMachines(vault(['empty.md', 'nothing here']), registry)
    expect(machines.map((m) => [m.serial, m.config, m.registered, m.entries.length])).toEqual([
      ['Z6A00101', 'D6 · LGP', true, 0],
      ['Z6A00202', 'D8', true, 0]
    ])
  })

  it('surfaces serials seen in notes but absent from the registry, after the registered ones', () => {
    const notes = vault([
      'log.md',
      '🚜 Z6A00101 known 📅 2026-07-10\n🚜 QQQ999 mystery 📅 2026-07-11'
    ])
    const { machines } = collectMachines(notes, registry)
    expect(machines.map((m) => m.serial)).toEqual(['Z6A00101', 'Z6A00202', 'QQQ999'])
    const mystery = machines.find((m) => m.serial === 'QQQ999')!
    expect(mystery).toMatchObject({ registered: false, config: 'unregistered' })
    expect(mystery.entries).toHaveLength(1)
  })

  it('orders entries newest first, with undated entries last', () => {
    const notes = vault([
      'log.md',
      [
        '🚜 Z6A00101 older 📅 2026-07-01',
        '🚜 Z6A00101 undated work',
        '🚜 Z6A00101 newer 📅 2026-07-20'
      ].join('\n')
    ])
    const { machines } = collectMachines(notes, registry)
    const z101 = machines.find((m) => m.serial === 'Z6A00101')!
    expect(z101.entries.map((e) => e.text)).toEqual(['newer', 'older', 'undated work'])
  })

  it('does not duplicate a machine listed twice in the registry', () => {
    const dupes: MachineDef[] = [
      { serial: 'Z6A00101', model: 'D6', attributes: [] },
      { serial: 'Z6A00101', model: 'D6', attributes: ['VP'] }
    ]
    expect(collectMachines(vault(['a.md', 'x']), dupes).machines).toHaveLength(1)
  })
})

describe('collectMilestones', () => {
  const TODAY = '2026-07-15'

  it('ignores milestones with no date', () => {
    const notes = vault(['a.md', '🏁 someday, maybe'])
    expect(collectMilestones(notes, TODAY)).toEqual([])
  })

  it('lists upcoming soonest-first, then past most-recent-first', () => {
    const notes = vault([
      'a.md',
      [
        '🏁 long past 📅 2026-01-01',
        '🏁 next week 📅 2026-07-22',
        '🏁 just passed 📅 2026-07-14',
        '🏁 tomorrow 📅 2026-07-16'
      ].join('\n')
    ])
    expect(collectMilestones(notes, TODAY).map((m) => m.text)).toEqual([
      'tomorrow',
      'next week',
      'just passed',
      'long past'
    ])
  })

  it("counts today's milestone as upcoming, not past", () => {
    const notes = vault(['a.md', '🏁 due today 📅 2026-07-15\n🏁 yesterday 📅 2026-07-14'])
    expect(collectMilestones(notes, TODAY).map((m) => m.text)).toEqual(['due today', 'yesterday'])
  })

  it('strips markers and records the source line for jumping', () => {
    const notes = vault(['plans/q3.md', 'intro\n🏁 !!! ship it #release 📅 2026-08-01'])
    expect(collectMilestones(notes, TODAY)).toEqual([
      {
        kind: 'milestone',
        path: 'plans/q3.md',
        noteTitle: 'q3',
        line: 1,
        text: 'ship it',
        date: '2026-08-01'
      }
    ])
  })
})

describe('relativeLabel', () => {
  const TODAY = '2026-07-15'

  it('names the near days instead of counting them', () => {
    expect(relativeLabel('2026-07-15', TODAY)).toBe('today')
    expect(relativeLabel('2026-07-16', TODAY)).toBe('tomorrow')
    expect(relativeLabel('2026-07-14', TODAY)).toBe('yesterday')
  })

  it('tiers by magnitude and pluralizes', () => {
    expect(relativeLabel('2026-07-18', TODAY)).toBe('in 3 days')
    expect(relativeLabel('2026-07-22', TODAY)).toBe('in 1 week')
    expect(relativeLabel('2026-08-15', TODAY)).toBe('in 1 month')
    expect(relativeLabel('2026-09-15', TODAY)).toBe('in 2 months')
  })

  it('reads past dates as "ago"', () => {
    expect(relativeLabel('2026-07-08', TODAY)).toBe('1 week ago')
    expect(relativeLabel('2026-06-15', TODAY)).toBe('1 month ago')
  })
})
