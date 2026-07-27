import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectCards,
  dueState,
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
