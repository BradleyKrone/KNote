import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  boardTags,
  collectCards,
  dueState,
  followUpState,
  matchesDateFilter,
  type BoardFilters
} from '@/board/boardSelectors'
import { parseNote } from '@shared/parser/parseNote'
import type { NoteMeta } from '@shared/types'

// Fixed "today" = Wednesday 2026-07-08, so the ISO week (Mon–Sun) runs 7/6–7/12.
beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-07-08T12:00:00')))
afterEach(() => vi.useRealTimers())

describe('matchesDateFilter', () => {
  it('matches anything under an "any" filter, including no value', () => {
    expect(matchesDateFilter(null, { kind: 'any' })).toBe(true)
    expect(matchesDateFilter('2026-07-08', { kind: 'any' })).toBe(true)
  })

  it('excludes a null value from every non-any filter', () => {
    expect(matchesDateFilter(null, { kind: 'today' })).toBe(false)
    expect(matchesDateFilter(null, { kind: 'week' })).toBe(false)
  })

  it('parses both YYYY-MM-DD (due) and M/D/YYYY (Status Changed/Date Entered) values', () => {
    expect(matchesDateFilter('2026-07-08', { kind: 'today' })).toBe(true)
    expect(matchesDateFilter('7/8/2026', { kind: 'today' })).toBe(true)
    expect(matchesDateFilter('7/7/2026', { kind: 'today' })).toBe(false)
  })

  it('"week" matches the ISO Mon–Sun week regardless of format', () => {
    expect(matchesDateFilter('2026-07-06', { kind: 'week' })).toBe(true) // Monday
    expect(matchesDateFilter('2026-07-12', { kind: 'week' })).toBe(true) // Sunday
    expect(matchesDateFilter('2026-07-05', { kind: 'week' })).toBe(false) // prior Sunday
    expect(matchesDateFilter('2026-07-13', { kind: 'week' })).toBe(false) // next Monday
  })

  it('"date" matches only that exact day', () => {
    expect(matchesDateFilter('7/10/2026', { kind: 'date', date: '2026-07-10' })).toBe(true)
    expect(matchesDateFilter('7/11/2026', { kind: 'date', date: '2026-07-10' })).toBe(false)
  })

  it('"range" is inclusive and treats a blank bound as open-ended', () => {
    expect(
      matchesDateFilter('2026-07-10', { kind: 'range', from: '2026-07-01', to: '2026-07-15' })
    ).toBe(true)
    expect(
      matchesDateFilter('2026-06-30', { kind: 'range', from: '2026-07-01', to: '2026-07-15' })
    ).toBe(false)
    expect(matchesDateFilter('2026-07-20', { kind: 'range', from: '2026-07-01', to: '' })).toBe(
      true
    )
    expect(matchesDateFilter('2026-06-01', { kind: 'range', from: '2026-07-01', to: '' })).toBe(
      false
    )
  })
})

describe('dueState', () => {
  const TODAY = '2026-07-08'
  const at = (due: string | null, statusChar = ' '): ReturnType<typeof dueState> =>
    dueState({ due, statusChar }, TODAY)

  it('has no state for a card without a due date', () => {
    expect(at(null)).toBe(null)
  })

  it('reads any past due date as overdue', () => {
    expect(at('2026-07-07')).toBe('overdue')
    expect(at('2026-01-01')).toBe('overdue')
  })

  it('reads the due date itself as today', () => {
    expect(at('2026-07-08')).toBe('today')
  })

  it('reads the next seven days as soon, and anything beyond as later', () => {
    expect(at('2026-07-09')).toBe('soon')
    expect(at('2026-07-15')).toBe('soon') // exactly a week out
    expect(at('2026-07-16')).toBe('later')
    expect(at('2026-12-01')).toBe('later')
  })

  it('never flags a done card, however overdue it is', () => {
    expect(at('2026-01-01', 'x')).toBe('later')
    expect(at('2026-01-01', 'X')).toBe('later')
    expect(at('2026-07-08', 'x')).toBe('later')
    // …but other columns are still coloured
    expect(at('2026-01-01', '/')).toBe('overdue')
  })

  it('reads the due date off a real parsed card', () => {
    const notes = new Map<string, NoteMeta>()
    notes.set('a.md', parseNote('a.md', '- [ ] ship it 📅 2026-07-07'))
    const [card] = collectCards(notes, { kind: 'global' }, { tag: null, text: '' })
    expect(dueState(card, TODAY)).toBe('overdue')
  })
})

// A Waiting follow-up date is coloured on exactly the same scale as a due
// date, so these mirror the dueState cases above one for one — if the two ever
// drift apart, one of these pairs breaks.
describe('followUpState', () => {
  const TODAY = '2026-07-08'
  const at = (waitingFollowUp: string | null, statusChar = 'w'): ReturnType<typeof followUpState> =>
    followUpState({ waitingFollowUp, statusChar }, TODAY)

  it('has no state for a card without a follow-up date', () => {
    expect(at(null)).toBe(null)
  })

  it('reads a follow-up date you have blown past as overdue', () => {
    expect(at('2026-07-07')).toBe('overdue')
    expect(at('2026-01-01')).toBe('overdue')
  })

  it('reads the follow-up date itself as today', () => {
    expect(at('2026-07-08')).toBe('today')
  })

  it('reads the next seven days as soon, and anything beyond as later', () => {
    expect(at('2026-07-09')).toBe('soon')
    expect(at('2026-07-15')).toBe('soon') // exactly a week out — the prompt's default
    expect(at('2026-07-16')).toBe('later')
    expect(at('2026-12-01')).toBe('later')
  })

  it('never flags a done card', () => {
    expect(at('2026-01-01', 'x')).toBe('later')
    expect(at('2026-01-01', 'X')).toBe('later')
  })

  it('reads the follow-up date off a real parsed card', () => {
    const notes = new Map<string, NoteMeta>()
    notes.set(
      'a.md',
      parseNote('a.md', '- [w] chase vendor\n  Reason for Waiting: parts on order ⏳ 2026-07-07\n')
    )
    const [card] = collectCards(notes, { kind: 'global' }, { tag: null, text: '' })
    expect(card.waitingFollowUp).toBe('2026-07-07')
    expect(followUpState(card, TODAY)).toBe('overdue')
  })

  it('goes null once the card leaves Waiting and the reason line is deleted', () => {
    // The date lives on the reason line, so clearing the reason clears it too —
    // this is what stops a moved card keeping a stale follow-up chip.
    const notes = new Map<string, NoteMeta>()
    notes.set('a.md', parseNote('a.md', '- [/] chase vendor\n  - Status Changed: 7/8/2026\n'))
    const [card] = collectCards(notes, { kind: 'global' }, { tag: null, text: '' })
    expect(card.waitingFollowUp).toBe(null)
    expect(card.waitingReason).toBe(null)
    expect(followUpState(card, TODAY)).toBe(null)
  })
})

describe('collectCards date filters', () => {
  const notes = new Map<string, NoteMeta>()
  const content = [
    '- [ ] no meta task',
    '- [/] in progress task 📅 2026-07-08',
    '  - Status Changed: 7/8/2026',
    '  - Date Entered: 7/1/2026',
    '- [x] done task 📅 2026-06-01',
    '  - Status Changed: 6/1/2026',
    '  - Date Entered: 6/1/2026'
  ].join('\n')
  notes.set('a.md', parseNote('a.md', content))

  const baseFilters: BoardFilters = { tag: null, text: '' }

  it('filters cards by Status Changed, excluding the task with no meta line', () => {
    const cards = collectCards(
      notes,
      { kind: 'global' },
      {
        ...baseFilters,
        statusChanged: { kind: 'today' }
      }
    )
    expect(cards.map((c) => c.displayText)).toEqual(['in progress task'])
  })

  it('filters cards by a Date Entered range', () => {
    const cards = collectCards(
      notes,
      { kind: 'global' },
      {
        ...baseFilters,
        dateEntered: { kind: 'range', from: '2026-06-15', to: '2026-07-05' }
      }
    )
    expect(cards.map((c) => c.displayText)).toEqual(['in progress task'])
  })

  it('strips a trailing ^block-id anchor from the card label', () => {
    const anchored = new Map<string, NoteMeta>()
    anchored.set('b.md', parseNote('b.md', '- [ ] test ^z2v9nn'))
    const cards = collectCards(anchored, { kind: 'global' }, baseFilters)
    expect(cards.map((c) => c.displayText)).toEqual(['test'])
  })

  it('filters cards by an exact Due date', () => {
    const cards = collectCards(
      notes,
      { kind: 'global' },
      {
        ...baseFilters,
        due: { kind: 'date', date: '2026-06-01' }
      }
    )
    expect(cards.map((c) => c.displayText)).toEqual(['done task'])
  })
})

// Project work only belongs on the board while its deliverable is running.
// "Today" is still 2026-07-08 from the fake timer at the top of this file.
describe('collectCards deliverable windows', () => {
  const notes = new Map<string, NoteMeta>()
  notes.set(
    'Project.md',
    parseNote(
      'Project.md',
      [
        '---',
        'type: project',
        'project: p',
        '---',
        '- [ ] Current 🛫 2026-07-01 📅 2026-07-31 #deliverable/p/current',
        '- [ ] Future 🛫 2026-09-01 📅 2026-09-30 #deliverable/p/future',
        '- [ ] Past 🛫 2026-06-01 📅 2026-06-30 #deliverable/p/past',
        ''
      ].join('\n')
    )
  )
  notes.set(
    'Work.md',
    parseNote(
      'Work.md',
      [
        '- [ ] plain task',
        '- [ ] current work #deliverable/p/current',
        '- [ ] future work #deliverable/p/future',
        '- [ ] late work #deliverable/p/past',
        '- [x] finished work #deliverable/p/past',
        '- [ ] orphan work #deliverable/p/ghost',
        ''
      ].join('\n')
    )
  )
  const baseFilters: BoardFilters = { tag: null, text: '' }
  const labels = (filters: BoardFilters = baseFilters): string[] =>
    collectCards(notes, { kind: 'note', path: 'Work.md' }, filters).map((c) => c.displayText)

  it('shows current and overdue-unchecked work, hides not-yet-started and finished-on-time work', () => {
    expect(labels()).toEqual(['plain task', 'current work', 'late work', 'orphan work'])
  })

  it('shows everything again under the escape-hatch toggle', () => {
    expect(labels({ ...baseFilters, ignoreDeliverableWindow: true })).toEqual([
      'plain task',
      'current work',
      'future work',
      'late work',
      'finished work',
      'orphan work'
    ])
  })

  it('gates deliverable lines themselves too — current and overdue only', () => {
    // "Past" is unchecked and its window has closed, so it stays visible as
    // late work; "Future" hasn't started, so it doesn't clutter the board yet.
    const project = collectCards(notes, { kind: 'note', path: 'Project.md' }, baseFilters)
    expect(project.map((c) => c.displayText)).toEqual(['Current', 'Past'])
  })

  it('never lets a closed deliverable shrink the tag dropdown', () => {
    expect(boardTags(notes, { kind: 'note', path: 'Work.md' })).toContain('deliverable/p/future')
  })

  describe('deliverableScope (the Boards tree filter)', () => {
    // Ignore the deliverable-window gate here — these tests are only about
    // which project/deliverable a card belongs to, not when it's visible.
    const scoped = (deliverableScope: BoardFilters['deliverableScope']): string[] =>
      collectCards(notes, { kind: 'global' }, { ...baseFilters, ignoreDeliverableWindow: true, deliverableScope }).map(
        (c) => c.displayText
      )

    it('null and { kind: "all" } both mean unfiltered', () => {
      const all = scoped(undefined)
      expect(scoped(null)).toEqual(all)
      expect(scoped({ kind: 'all' })).toEqual(all)
      expect(all).toContain('plain task')
      expect(all).toContain('current work')
    })

    it('"unassigned" keeps only cards with no deliverable tag at all', () => {
      expect(scoped({ kind: 'unassigned' })).toEqual(['plain task'])
    })

    it('"project" matches every card tagged under that project, regardless of deliverable', () => {
      expect(scoped({ kind: 'project', slug: 'p', label: 'P' })).toEqual([
        'Current',
        'Future',
        'Past',
        'current work',
        'future work',
        'late work',
        'finished work',
        'orphan work'
      ])
    })

    it('"project" for an unknown slug matches nothing', () => {
      expect(scoped({ kind: 'project', slug: 'nope', label: 'Nope' })).toEqual([])
    })

    it('"deliverable" narrows to the exact tag', () => {
      expect(scoped({ kind: 'deliverable', tag: 'deliverable/p/current', label: 'Current' })).toEqual([
        'Current',
        'current work'
      ])
    })
  })
})
