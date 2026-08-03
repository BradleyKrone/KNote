import { describe, expect, it } from 'vitest'
import {
  addDependency,
  dependencies,
  removeDependency,
  setDeliverableDates,
  setStartDate
} from '@/shared/taskMeta'
import { stripInlineMarkers } from '@shared/parser/patterns'

// The planner's writes are all single-line rewrites of a deliverable line.
// Every one of them has to survive a trailing ^block-id anchor, because an
// anchor that isn't last stops being an anchor (see BLOCK_ID_RE).

const LINE = '- [ ] Design 🛫 2026-04-01 📅 2026-04-20 #deliverable/p/design'

describe('setStartDate', () => {
  it('adds, replaces and clears the 🛫 marker without duplicating it', () => {
    const added = setStartDate('Design 📅 2026-04-20', '2026-04-01')
    expect(added).toBe('Design 📅 2026-04-20 🛫 2026-04-01')
    expect(setStartDate(added, '2026-04-02')).toBe('Design 📅 2026-04-20 🛫 2026-04-02')
    expect(setStartDate(added, null)).toBe('Design 📅 2026-04-20')
  })

  it('accepts an @start(...) marker on read', () => {
    expect(setStartDate('Design @start(2026-04-01)', '2026-04-05')).toBe('Design 🛫 2026-04-05')
  })
})

describe('setDeliverableDates', () => {
  it('rewrites both dates in one pass, in canonical order', () => {
    expect(setDeliverableDates(LINE, '2026-04-06', '2026-04-25')).toBe(
      '- [ ] Design #deliverable/p/design 🛫 2026-04-06 📅 2026-04-25'
    )
  })

  it('is idempotent — re-applying the same dates changes nothing', () => {
    const once = setDeliverableDates(LINE, '2026-04-06', '2026-04-25')
    expect(setDeliverableDates(once, '2026-04-06', '2026-04-25')).toBe(once)
  })

  it('keeps a trailing ^block-id last', () => {
    const anchored = `${LINE} ^design1`
    const moved = setDeliverableDates(anchored, '2026-05-01', '2026-05-20')
    expect(moved.endsWith(' ^design1')).toBe(true)
    expect(moved).toContain('🛫 2026-05-01 📅 2026-05-20')
  })

  it('preserves dependency markers', () => {
    const withDep = `${LINE} ⛓ #deliverable/p/contracts`
    const moved = setDeliverableDates(withDep, '2026-05-01', '2026-05-20')
    expect(dependencies(moved)).toEqual(['deliverable/p/contracts'])
  })
})

describe('addDependency / removeDependency', () => {
  it('appends a marker and refuses to duplicate it', () => {
    const once = addDependency(LINE, 'deliverable/p/contracts')
    expect(once).toBe(`${LINE} ⛓ #deliverable/p/contracts`)
    expect(addDependency(once, 'deliverable/p/contracts')).toBe(once)
  })

  it('supports several dependencies and removes just the named one', () => {
    let line = addDependency(LINE, 'deliverable/p/a')
    line = addDependency(line, 'deliverable/p/b')
    expect(dependencies(line)).toEqual(['deliverable/p/a', 'deliverable/p/b'])
    expect(dependencies(removeDependency(line, 'deliverable/p/a'))).toEqual(['deliverable/p/b'])
  })

  it('keeps a trailing ^block-id last', () => {
    const linked = addDependency(`${LINE} ^design1`, 'deliverable/p/contracts')
    expect(linked.endsWith(' ^design1')).toBe(true)
    expect(dependencies(linked)).toEqual(['deliverable/p/contracts'])
  })
})

describe('stripInlineMarkers', () => {
  it('strips start dates and dependency markers, leaving no orphaned ⛓', () => {
    expect(stripInlineMarkers('Design 🛫 2026-04-01 📅 2026-04-20 #deliverable/p/design')).toBe(
      'Design'
    )
    expect(stripInlineMarkers('Design ⛓ #deliverable/p/contracts')).toBe('Design')
    expect(stripInlineMarkers('Design ⛓ #deliverable/p/a ⛓ #deliverable/p/b')).toBe('Design')
  })
})
