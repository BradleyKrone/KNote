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

describe('collectCards waiting-reason tags', () => {
  it('merges a #tag from the reason line into card.tags, deduped against the task line', () => {
    const notes = new Map<string, NoteMeta>()
    notes.set(
      'a.md',
      parseNote(
        'a.md',
        '- [w] chase vendor #urgent\n  Reason for Waiting: blocked on #vendor #urgent pricing ⏳ 2026-07-15\n'
      )
    )
    const [card] = collectCards(notes, { kind: 'global' }, { tag: null, text: '' })
    expect(card.tags.sort()).toEqual(['urgent', 'vendor'])
  })

  it('leaves card.tags untouched when there is no waiting reason', () => {
    const notes = new Map<string, NoteMeta>()
    notes.set('a.md', parseNote('a.md', '- [ ] plain task #foo\n'))
    const [card] = collectCards(notes, { kind: 'global' }, { tag: null, text: '' })
    expect(card.tags).toEqual(['foo'])
  })

  it('drops the reason tag once the task leaves Waiting and the reason line is deleted', () => {
    const notes = new Map<string, NoteMeta>()
    notes.set('a.md', parseNote('a.md', '- [/] chase vendor\n  - Status Changed: 7/8/2026\n'))
    const [card] = collectCards(notes, { kind: 'global' }, { tag: null, text: '' })
    expect(card.tags).toEqual([])
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
        '- [ ] current work @deliverable(p/current)',
        '- [ ] future work @deliverable(p/future)',
        '- [ ] late work @deliverable(p/past)',
        '- [x] finished work @deliverable(p/past)',
        '- [ ] orphan work @deliverable(p/ghost)',
        ''
      ].join('\n')
    )
  )
  const baseFilters: BoardFilters = { tag: null, text: '' }
  const labels = (filters: BoardFilters = baseFilters): string[] =>
    collectCards(notes, { kind: 'note', path: 'Work.md' }, filters).map((c) => c.displayText)

  it('shows current, overdue and finished work, hides only not-yet-started work', () => {
    // Completion is never a visibility signal — "finished work" stays on the
    // board once its deliverable has started, exactly like "late work". Only
    // "future work" (deliverable hasn't started yet) is gated out.
    expect(labels()).toEqual([
      'plain task',
      'current work',
      'late work',
      'finished work',
      'orphan work'
    ])
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

  it('leaves definesDeliverable/progress null on an ordinary task, including one that joins a deliverable', () => {
    // "Current"/"Past" in Project.md are written with the legacy #deliverable/…
    // tag, which deliverableMembershipOf still reads as membership but
    // definingDeliverableTag does not recognize as a *defining* line (it only
    // reads the current @deliverable(...) text marker — see the "defines a
    // deliverable" describe block below for that case).
    const work = collectCards(
      notes,
      { kind: 'note', path: 'Work.md' },
      {
        ...baseFilters,
        ignoreDeliverableWindow: true
      }
    )
    const currentWork = work.find((c) => c.displayText === 'current work')
    expect(currentWork?.definesDeliverable).toBeNull()
    expect(currentWork?.progress).toBeNull()
  })

  it('never surfaces a deliverable join marker as a #tag in the dropdown', () => {
    // Joining a deliverable is `@deliverable(...)`, not a #tag, so it must
    // never show up alongside real content tags.
    expect(boardTags(notes, { kind: 'note', path: 'Work.md' })).not.toContain(
      'deliverable/p/future'
    )
  })

  describe('deliverableScope (the Boards tree filter)', () => {
    // Ignore the deliverable-window gate here — these tests are only about
    // which project/deliverable a card belongs to, not when it's visible.
    const scoped = (deliverableScope: BoardFilters['deliverableScope']): string[] =>
      collectCards(
        notes,
        { kind: 'global' },
        { ...baseFilters, ignoreDeliverableWindow: true, deliverableScope }
      ).map((c) => c.displayText)

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
      expect(
        scoped({ kind: 'deliverable', tag: 'deliverable/p/current', label: 'Current' })
      ).toEqual(['Current', 'current work'])
    })
  })
})

describe('collectCards hiddenProjects (the Boards tree exclude checkbox)', () => {
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
        '- [ ] Design @deliverable(p/design)',
        '- [ ] plain note task with no deliverable marker',
        ''
      ].join('\n')
    )
  )
  notes.set(
    'Work.md',
    parseNote(
      'Work.md',
      ['- [ ] unrelated task', '- [ ] design task @deliverable(p/design)', ''].join('\n')
    )
  )
  const baseFilters: BoardFilters = { tag: null, text: '', ignoreDeliverableWindow: true }
  const labels = (hiddenProjects?: ReadonlySet<string>): string[] =>
    collectCards(notes, { kind: 'global' }, { ...baseFilters, hiddenProjects }).map(
      (c) => c.displayText
    )

  it('shows everything when no project is hidden', () => {
    expect(labels()).toEqual([
      'Design',
      'plain note task with no deliverable marker',
      'unrelated task',
      'design task'
    ])
  })

  it('drops the defining line and every joined task once the project is hidden', () => {
    expect(labels(new Set(['p']))).toEqual([
      'plain note task with no deliverable marker',
      'unrelated task'
    ])
  })

  it('leaves an unrelated plain checkbox in the project note visible', () => {
    expect(labels(new Set(['p']))).toContain('plain note task with no deliverable marker')
  })

  it('an empty or unmatched hidden set changes nothing', () => {
    expect(labels(new Set())).toEqual(labels())
    expect(labels(new Set(['other']))).toEqual(labels())
  })
})

describe('collectCards deliverable-defining card', () => {
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
        '- [ ] Design 🛫 2026-07-01 📅 2026-07-31 @deliverable(p/design)',
        '- [ ] Permits 🛫 2026-07-01 📅 2026-07-31 @deliverable(p/permits)',
        '- [ ] task 1 @deliverable(p/design)',
        ''
      ].join('\n')
    )
  )
  notes.set(
    'Work.md',
    parseNote(
      'Work.md',
      [
        '- [x] Sketch layout @deliverable(p/design)',
        '- [ ] Pick materials @deliverable(p/design)',
        ''
      ].join('\n')
    )
  )
  const baseFilters: BoardFilters = { tag: null, text: '', ignoreDeliverableWindow: true }

  it("marks the defining card and rolls up its member tasks' completion", () => {
    const project = collectCards(notes, { kind: 'note', path: 'Project.md' }, baseFilters)
    const design = project.find((c) => c.displayText === 'Design')
    expect(design?.definesDeliverable).toBe('deliverable/p/design')
    // 2 members: "Sketch layout"/"Pick materials" in Work.md, plus "task 1"
    // below, a plain top-level task in the *same* project note that joins
    // the same deliverable without a span of its own.
    expect(design?.progress).toEqual({ done: 1, total: 3 })
  })

  it('does not mistake an undated top-level task in the project note for a second defining line', () => {
    // Regression: a plain task in the project note carrying the same
    // @deliverable(...) marker but no 🛫/📅 span must not itself be flagged
    // as "defining" just because it's top-level in the right note — only
    // "Design", which actually carries the span, defines the deliverable.
    const project = collectCards(notes, { kind: 'note', path: 'Project.md' }, baseFilters)
    const task1 = project.find((c) => c.displayText === 'task 1')
    expect(task1?.definesDeliverable).toBeNull()
    expect(task1?.progress).toBeNull()
  })

  it('reports total: 0 for a deliverable with no member tasks yet', () => {
    const project = collectCards(notes, { kind: 'note', path: 'Project.md' }, baseFilters)
    const permits = project.find((c) => c.displayText === 'Permits')
    expect(permits?.definesDeliverable).toBe('deliverable/p/permits')
    expect(permits?.progress).toEqual({ done: 0, total: 0 })
  })

  it('leaves definesDeliverable/progress null on a card that only joins', () => {
    const work = collectCards(notes, { kind: 'note', path: 'Work.md' }, baseFilters)
    const pickMaterials = work.find((c) => c.displayText === 'Pick materials')
    expect(pickMaterials?.definesDeliverable).toBeNull()
    expect(pickMaterials?.progress).toBeNull()
  })
})

describe('collectCards — a dated member task in the project note', () => {
  // Regression, from a real vault: "Doze Assist Video" is an ordinary task that
  // joins a deliverable, but it is top-level, lives in the project note and
  // carries a 📅 of its own — so the old last-in-file rule let it overwrite the
  // deliverable's window with its own single day. On 2026-08-13 that window
  // ("2026-08-14 → 2026-08-14") read as not-yet-started and the entire
  // deliverable — every task in it, and its own defining line — vanished from
  // the board.
  const notes = new Map<string, NoteMeta>()
  notes.set(
    'Doze.md',
    parseNote(
      'Doze.md',
      [
        '---',
        'type: project',
        'project: doze-assist',
        '---',
        '- [ ] MTP & MG QSM planning meeting @deliverable(doze-assist/mtp-mg-qsm-planning-meeting) 🛫 2026-08-12 📅 2026-08-27',
        '- [w] Doze Assist Video 📅 2026-08-14 #Doze_Assist @deliverable(doze-assist/mtp-mg-qsm-planning-meeting)',
        '- [ ] Planning Meeting Machine @deliverable(doze-assist/mtp-mg-qsm-planning-meeting)',
        '- [ ] Machine setup @deliverable(doze-assist/mtp-mg-qsm-planning-meeting)',
        ''
      ].join('\n')
    )
  )
  const baseFilters: BoardFilters = { tag: null, text: '' }
  const cards = (): ReturnType<typeof collectCards> =>
    collectCards(notes, { kind: 'note', path: 'Doze.md' }, baseFilters)

  beforeEach(() => vi.setSystemTime(new Date('2026-08-13T12:00:00')))

  it('keeps the whole deliverable on the board', () => {
    expect(cards().map((c) => c.displayText)).toEqual([
      'MTP & MG QSM planning meeting',
      'Doze Assist Video',
      'Planning Meeting Machine',
      'Machine setup'
    ])
  })

  it('leaves the member card claiming no deliverable of its own', () => {
    const video = cards().find((c) => c.displayText === 'Doze Assist Video')
    expect(video?.definesDeliverable).toBeNull()
    expect(video?.progress).toBeNull()
  })

  it('counts the member toward the deliverable card’s progress', () => {
    const deliverable = cards().find((c) => c.displayText === 'MTP & MG QSM planning meeting')
    expect(deliverable?.definesDeliverable).toBe(
      'deliverable/doze-assist/mtp-mg-qsm-planning-meeting'
    )
    expect(deliverable?.progress).toEqual({ done: 0, total: 3 })
  })
})

describe('collectCards deliverable overdue', () => {
  // Windows fixed safely in the past (design) and safely in the future
  // (landscaping) so these assertions hold regardless of the real clock —
  // collectCards reads `now` from dayjs(), not an injectable date.
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
        '- [ ] Design 🛫 2020-01-01 📅 2020-01-31 @deliverable(p/design)',
        '- [ ] Landscaping 🛫 2020-01-01 📅 2099-01-01 @deliverable(p/landscaping)',
        ''
      ].join('\n')
    )
  )
  notes.set(
    'Work.md',
    parseNote(
      'Work.md',
      [
        '- [ ] design task, no due of its own @deliverable(p/design)',
        '- [ ] landscaping task, no due of its own @deliverable(p/landscaping)',
        ''
      ].join('\n')
    )
  )
  const baseFilters: BoardFilters = { tag: null, text: '', ignoreDeliverableWindow: true }

  it('flags a member task as overdue via its deliverable, even with no @due() of its own', () => {
    const work = collectCards(notes, { kind: 'note', path: 'Work.md' }, baseFilters)
    const task = work.find((c) => c.displayText === 'design task, no due of its own')
    expect(task?.due).toBeNull()
    expect(task?.overdueDeliverables).toEqual(['deliverable/p/design'])
  })

  it('leaves a member task alone when its deliverable is not yet due', () => {
    const work = collectCards(notes, { kind: 'note', path: 'Work.md' }, baseFilters)
    const task = work.find((c) => c.displayText === 'landscaping task, no due of its own')
    expect(task?.overdueDeliverables).toEqual([])
  })

  it('the defining card itself is also flagged', () => {
    const project = collectCards(notes, { kind: 'note', path: 'Project.md' }, baseFilters)
    const design = project.find((c) => c.displayText === 'Design')
    expect(design?.overdueDeliverables).toEqual(['deliverable/p/design'])
  })
})
