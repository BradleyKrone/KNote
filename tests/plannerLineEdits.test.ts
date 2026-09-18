import { describe, expect, it } from 'vitest'
import {
  addDependency,
  clearParentDeliverableRef,
  dependencies,
  removeDependency,
  setDeliverableDates,
  setParentDeliverableRef,
  setStartDate
} from '@/shared/taskMeta'
import { parentNameOf } from '@shared/deliverables'
import { PARENT_RE, stripInlineMarkers } from '@shared/parser/patterns'

// The planner's writes are all single-line rewrites of a deliverable line.
// Every one of them has to survive a trailing ^block-id anchor, because an
// anchor that isn't last stops being an anchor (see BLOCK_ID_RE).

const LINE = '- [ ] @task Design 🛫 2026-04-01 📅 2026-04-20 #deliverable/p/design'

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
      '- [ ] @task Design #deliverable/p/design 🛫 2026-04-06 📅 2026-04-25'
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
    expect(once).toBe(`${LINE} ⛓ @deliverable(p/contracts)`)
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

  it('still reads a legacy ⛓ #deliverable/... marker, and can remove it', () => {
    const legacy = `${LINE} ⛓ #deliverable/p/contracts`
    expect(dependencies(legacy)).toEqual(['deliverable/p/contracts'])
    expect(removeDependency(legacy, 'deliverable/p/contracts')).toBe(LINE)
  })

  it('reads both marker forms on the same line', () => {
    const mixed = `${LINE} ⛓ #deliverable/p/a ⛓ @deliverable(p/b)`
    expect(dependencies(mixed)).toEqual(['deliverable/p/a', 'deliverable/p/b'])
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

  it('strips a @deliverable(...) join marker, leaving no orphaned text', () => {
    expect(stripInlineMarkers('Draft wireframes @deliverable(p/design)')).toBe('Draft wireframes')
  })

  it('strips a @parent(...) work-package marker', () => {
    expect(stripInlineMarkers('Fix product bugs @parent(release-1)')).toBe('Fix product bugs')
  })
})

describe('PARENT_RE / parentNameOf', () => {
  it('reads the name out of an @parent(name) marker', () => {
    expect(parentNameOf('Fix product bugs @parent(release-1)')).toBe('release-1')
  })

  it('is null when there is no marker', () => {
    expect(parentNameOf('Fix product bugs')).toBeNull()
  })

  it('matches only the bare name shape, no project segment', () => {
    expect(PARENT_RE.test('@parent(release-1)')).toBe(true)
    expect(PARENT_RE.test('@parent(software/release-1)')).toBe(false)
  })
})

describe('setParentDeliverableRef / clearParentDeliverableRef', () => {
  it('appends the marker when there is none yet', () => {
    expect(setParentDeliverableRef('Fix product bugs', 'release-1')).toBe(
      'Fix product bugs @parent(release-1)'
    )
  })

  it('replaces an existing marker rather than appending a second one', () => {
    const once = setParentDeliverableRef('Fix product bugs', 'release-1')
    expect(setParentDeliverableRef(once, 'release-2')).toBe('Fix product bugs @parent(release-2)')
  })

  it('clears the marker, leaving no orphaned text', () => {
    const withParent = setParentDeliverableRef('Fix product bugs', 'release-1')
    expect(clearParentDeliverableRef(withParent)).toBe('Fix product bugs')
  })

  it('clearing when there is no marker is a no-op', () => {
    expect(clearParentDeliverableRef('Fix product bugs')).toBe('Fix product bugs')
  })

  it('keeps a trailing ^block-id last', () => {
    const anchored = 'Fix product bugs ^fix-bugs'
    const withParent = setParentDeliverableRef(anchored, 'release-1')
    expect(withParent).toBe('Fix product bugs @parent(release-1) ^fix-bugs')
    expect(clearParentDeliverableRef(withParent)).toBe(anchored)
  })
})
