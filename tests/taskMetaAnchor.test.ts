// A task's ` ^anchor` has to stay at end of line. Every inline marker is
// written by appending to the line, so setting a due date / priority / tag /
// completion date on an already-anchored task used to bury the anchor mid-line
// — which unlinks it: it stops being indexed, `[[Note#^id]]` links to it break,
// and the raw `^id` becomes visible in live preview instead of being hidden.

import { describe, expect, it } from 'vitest'
import { blockIdOf } from '@shared/blockAnchor'
import { preservingBlockId, setTaskDone } from '@shared/parser/patterns'
import { insertTag, setDueDate, setPriority } from '../src/webviews/shared/taskMeta'

const ANCHORED = 'Rewire the pump ^rewire-the-pump'

describe('markers never bury a block anchor', () => {
  it('keeps the anchor last when a due date is set', () => {
    expect(setDueDate(ANCHORED, '2026-07-28')).toBe(
      'Rewire the pump 📅 2026-07-28 ^rewire-the-pump'
    )
  })

  it('keeps the anchor last when a priority is set', () => {
    expect(setPriority(ANCHORED, 2)).toBe('Rewire the pump !! ^rewire-the-pump')
  })

  it('keeps the anchor last when a tag is added', () => {
    expect(insertTag(ANCHORED, 'shop')).toBe('Rewire the pump #shop ^rewire-the-pump')
  })

  it('keeps the anchor last when a sub-task is completed', () => {
    const done = setTaskDone('  - [ ] Bleed the lines ^bleed-the-lines', true, '2026-07-28')
    expect(done).toBe('  - [x] Bleed the lines ✅ 2026-07-28 ^bleed-the-lines')
    expect(setTaskDone(done!, false, '2026-07-28')).toBe('  - [ ] Bleed the lines ^bleed-the-lines')
  })

  it('survives every marker stacked up, and the anchor stays resolvable', () => {
    let line = ANCHORED
    line = setDueDate(line, '2026-07-28')
    line = setPriority(line, 3)
    line = insertTag(line, 'shop')
    expect(line).toBe('Rewire the pump 📅 2026-07-28 !!! #shop ^rewire-the-pump')
    expect(blockIdOf(line)).toBe('rewire-the-pump')
  })

  it('still clears a due date without disturbing the anchor', () => {
    const withDue = setDueDate(ANCHORED, '2026-07-28')
    expect(setDueDate(withDue, null)).toBe(ANCHORED)
  })

  it('leaves an unanchored line exactly as before', () => {
    expect(setDueDate('Plain task', '2026-07-28')).toBe('Plain task 📅 2026-07-28')
    expect(setPriority('Plain task', 1)).toBe('Plain task !')
    expect(insertTag('Plain task', 'shop')).toBe('Plain task #shop')
  })

  it('does not treat a caret in prose as an anchor', () => {
    expect(setDueDate('Solve a^2 + b^2 = c^2', '2026-07-28')).toBe(
      'Solve a^2 + b^2 = c^2 📅 2026-07-28'
    )
  })
})

describe('repairing a line already broken on disk', () => {
  const broken = 'Rewire the pump ^rewire-the-pump 📅 2026-07-28 #shop'

  it('moves the anchor back to the end on the next write', () => {
    expect(setDueDate(broken, '2026-08-01')).toBe(
      'Rewire the pump #shop 📅 2026-08-01 ^rewire-the-pump'
    )
  })

  it('resolves the anchor even before anything rewrites the line', () => {
    expect(blockIdOf(broken)).toBe('rewire-the-pump')
  })
})

describe('preservingBlockId', () => {
  it('passes the whole text through when there is no anchor', () => {
    expect(preservingBlockId('just text', (t) => `${t}!`)).toBe('just text!')
  })

  it('hides the anchor from the callback', () => {
    const seen: string[] = []
    preservingBlockId('body text ^id', (t) => {
      seen.push(t)
      return t
    })
    expect(seen).toEqual(['body text'])
  })

  it('keeps a bare anchor when the callback empties the body', () => {
    expect(preservingBlockId('body ^id', () => '')).toBe('^id')
  })
})
