import { describe, expect, it } from 'vitest'
import {
  deliverableMembershipOf,
  deliverableProgress,
  deliverableRefMarker,
  deliverableRefsOf,
  deliverableTagsOf,
  liveDeliverables,
  overdueDeliverables
} from '@shared/deliverables'
import { parseNote } from '@shared/parser/parseNote'
import type { NoteMeta } from '@shared/types'

describe('deliverableRefsOf', () => {
  it('reads an @deliverable(project/name) marker as a bare deliverable tag', () => {
    expect(deliverableRefsOf('Draft wireframes @deliverable(govalle/design)')).toEqual([
      'deliverable/govalle/design'
    ])
  })

  it('reads several markers on one line', () => {
    expect(
      deliverableRefsOf('Shared task @deliverable(govalle/design) @deliverable(govalle/permits)')
    ).toEqual(['deliverable/govalle/design', 'deliverable/govalle/permits'])
  })

  it('is empty for text with no marker', () => {
    expect(deliverableRefsOf('Plain task #deliverable/govalle/design')).toEqual([])
  })
})

describe('deliverableTagsOf', () => {
  it('recognizes a legacy #deliverable/... tag (from the indexed tags array)', () => {
    expect(deliverableTagsOf(['deliverable/govalle/design'], 'Design 📅 2026-04-20')).toEqual([
      'deliverable/govalle/design'
    ])
  })

  it('recognizes a current @deliverable(...) marker (read off the text, not the tags array)', () => {
    expect(deliverableTagsOf([], 'Design @deliverable(govalle/design) 📅 2026-04-20')).toEqual([
      'deliverable/govalle/design'
    ])
  })

  it('excludes a legacy dependency tag from the tags array so it never counts as a definition', () => {
    expect(
      deliverableTagsOf(
        ['deliverable/govalle/design', 'deliverable/govalle/contracts'],
        'Design ⛓ #deliverable/govalle/contracts'
      )
    ).toEqual(['deliverable/govalle/design'])
  })

  it('a current ⛓ @deliverable(...) dependency never enters the tags array, so nothing needs excluding', () => {
    expect(
      deliverableTagsOf(['deliverable/govalle/design'], 'Design ⛓ @deliverable(govalle/contracts)')
    ).toEqual(['deliverable/govalle/design'])
  })
})

describe('deliverableMembershipOf', () => {
  it('never picks up a join marker as one of the tags array (it is not a #tag)', () => {
    // Simulates what the indexer's TAG_RE-based `tags` array actually looks
    // like for a line carrying only `@deliverable(...)` — empty.
    expect(deliverableMembershipOf([], 'Draft wireframes @deliverable(govalle/design)')).toEqual([
      'deliverable/govalle/design'
    ])
  })

  it('still recognizes the deliverable tag on a defining line', () => {
    expect(deliverableMembershipOf(['deliverable/govalle/design'], 'Design 📅 2026-04-20')).toEqual(
      ['deliverable/govalle/design']
    )
  })

  it('dedupes when both markers somehow name the same deliverable', () => {
    expect(
      deliverableMembershipOf(['deliverable/govalle/design'], 'Design @deliverable(govalle/design)')
    ).toEqual(['deliverable/govalle/design'])
  })

  it('matches deliverableTagsOf when only the legacy tag is present', () => {
    const tags = ['deliverable/govalle/design']
    expect(deliverableMembershipOf(tags, '')).toEqual(deliverableTagsOf(tags, ''))
  })
})

describe('deliverableRefMarker', () => {
  it('turns a bare deliverable tag into its @deliverable(...) join text', () => {
    expect(deliverableRefMarker('deliverable/govalle/design')).toBe('@deliverable(govalle/design)')
  })

  it('throws on a string that is not a deliverable tag', () => {
    expect(() => deliverableRefMarker('not-a-deliverable-tag')).toThrow()
  })
})

describe('liveDeliverables', () => {
  const vault = (): Map<string, NoteMeta> => {
    const notes = new Map<string, NoteMeta>()
    notes.set(
      'Govalle.md',
      parseNote(
        'Govalle.md',
        [
          '---',
          'type: project',
          'project: govalle',
          '---',
          '- [ ] Design 🛫 2026-04-01 📅 2026-04-20 #deliverable/govalle/design',
          '- [ ] no span, not scheduled #deliverable/govalle/notreally',
          ''
        ].join('\n')
      )
    )
    notes.set(
      'Old.md',
      parseNote(
        'Old.md',
        '---\ntype: project\nproject: old\nstatus: completed\n---\n- [ ] A 📅 2026-02-01 #deliverable/old/a\n'
      )
    )
    return notes
  }

  it('lists a live deliverable with its defining task as the label', () => {
    const options = liveDeliverables(vault())
    expect(options).toEqual([
      {
        tag: 'deliverable/govalle/design',
        project: 'govalle',
        deliverable: 'design',
        label: 'Design'
      }
    ])
  })

  it('excludes a deliverable-shaped tag with no schedule', () => {
    expect(liveDeliverables(vault()).map((d) => d.tag)).not.toContain(
      'deliverable/govalle/notreally'
    )
  })

  it('excludes deliverables of a completed project', () => {
    expect(liveDeliverables(vault()).map((d) => d.tag)).not.toContain('deliverable/old/a')
  })

  it('lists a deliverable defined with the current @deliverable(...) marker, not just the legacy #tag', () => {
    const notes = new Map<string, NoteMeta>()
    notes.set(
      'Newstyle.md',
      parseNote(
        'Newstyle.md',
        [
          '---',
          'type: project',
          'project: newstyle',
          '---',
          '- [ ] Build 🛫 2026-05-01 📅 2026-05-20 @deliverable(newstyle/build)',
          ''
        ].join('\n')
      )
    )
    expect(liveDeliverables(notes)).toEqual([
      {
        tag: 'deliverable/newstyle/build',
        project: 'newstyle',
        deliverable: 'build',
        label: 'Build'
      }
    ])
  })

  it('keeps the defining task as the label even when a later top-level task only joins it', () => {
    // Regression: a plain top-level task that joins the deliverable (no span
    // of its own) was overwriting the label set by the actual defining line,
    // so the picker offered the joining task's own text as if it were a
    // deliverable in its own right.
    const notes = new Map<string, NoteMeta>()
    notes.set(
      'PreSeason.md',
      parseNote(
        'PreSeason.md',
        [
          '---',
          'type: project',
          'project: pre-season-2026',
          '---',
          '- [ ] fun stuff 🛫 2026-07-24 📅 2026-08-14 @deliverable(pre-season-2026/fun-stuff)',
          '- [ ] do stuff @deliverable(pre-season-2026/fun-stuff)',
          ''
        ].join('\n')
      )
    )
    expect(liveDeliverables(notes)).toEqual([
      {
        tag: 'deliverable/pre-season-2026/fun-stuff',
        project: 'pre-season-2026',
        deliverable: 'fun-stuff',
        label: 'fun stuff'
      }
    ])
  })
})

describe('deliverableProgress', () => {
  const vault = (): Map<string, NoteMeta> => {
    const notes = new Map<string, NoteMeta>()
    notes.set(
      'Govalle.md',
      parseNote(
        'Govalle.md',
        [
          '---',
          'type: project',
          'project: govalle',
          '---',
          '- [ ] Design 🛫 2026-04-01 📅 2026-04-20 @deliverable(govalle/design)',
          '- [ ] Permits 📅 2026-05-01 @deliverable(govalle/permits)',
          '- [ ] task 1 @deliverable(govalle/design)',
          ''
        ].join('\n')
      )
    )
    notes.set(
      'Elsewhere.md',
      parseNote(
        'Elsewhere.md',
        [
          '- [x] Sketch layout @deliverable(govalle/design)',
          '- [ ] Pick materials @deliverable(govalle/design)',
          '  - [x] Subtask, still counts @deliverable(govalle/design)',
          ''
        ].join('\n')
      )
    )
    return notes
  }

  it('counts member tasks anywhere in the vault, split done/total', () => {
    const progress = deliverableProgress(vault())
    // 3 tasks in Elsewhere.md + "task 1" (a plain, undated top-level task in
    // the project note that joins the same deliverable) = 4 members.
    expect(progress.get('deliverable/govalle/design')).toEqual({ done: 2, total: 4 })
  })

  it('never counts the defining line itself as a member, but does count an undated top-level task that only joins', () => {
    // Regression: without requireSpan threaded through, "task 1" — top-level,
    // in the project note, same @deliverable(...) project, but no span of its
    // own — was mistaken for a second "defining" line and silently dropped
    // from the count instead of counted as a member.
    const progress = deliverableProgress(vault())
    expect(progress.get('deliverable/govalle/design')?.total).toBe(4)
  })

  it('is absent for a deliverable with no member tasks', () => {
    const progress = deliverableProgress(vault())
    expect(progress.get('deliverable/govalle/permits')).toBeUndefined()
  })
})

describe('overdueDeliverables', () => {
  const notes = new Map<string, NoteMeta>()
  notes.set(
    'Govalle.md',
    parseNote(
      'Govalle.md',
      [
        '---',
        'type: project',
        'project: govalle',
        '---',
        // Past due, unfinished members — overdue.
        '- [ ] Design 🛫 2026-04-01 📅 2026-04-20 @deliverable(govalle/design)',
        // Past due, every member done — not overdue.
        '- [ ] Permits 🛫 2026-04-01 📅 2026-04-20 @deliverable(govalle/permits)',
        // Past due, no members, own checkbox unchecked — overdue.
        '- [ ] Signage 🛫 2026-04-01 📅 2026-04-20 @deliverable(govalle/signage)',
        // Past due, no members, own checkbox checked — not overdue.
        '- [x] Survey 🛫 2026-04-01 📅 2026-04-20 @deliverable(govalle/survey)',
        // Not yet due — not overdue regardless of completion.
        '- [ ] Landscaping 🛫 2026-04-01 📅 2099-01-01 @deliverable(govalle/landscaping)',
        ''
      ].join('\n')
    )
  )
  notes.set(
    'Work.md',
    parseNote(
      'Work.md',
      [
        '- [ ] design task @deliverable(govalle/design)',
        '- [x] permits task @deliverable(govalle/permits)',
        ''
      ].join('\n')
    )
  )
  const today = '2026-05-01'

  it('flags a deliverable past its window with unfinished member tasks', () => {
    expect(overdueDeliverables(notes, today).has('deliverable/govalle/design')).toBe(true)
  })

  it('does not flag a deliverable past its window whose members are all done', () => {
    expect(overdueDeliverables(notes, today).has('deliverable/govalle/permits')).toBe(false)
  })

  it("falls back to the defining line's own checkbox when a deliverable has no members", () => {
    const overdue = overdueDeliverables(notes, today)
    expect(overdue.has('deliverable/govalle/signage')).toBe(true)
    expect(overdue.has('deliverable/govalle/survey')).toBe(false)
  })

  it('never flags a deliverable whose window has not closed yet', () => {
    expect(overdueDeliverables(notes, today).has('deliverable/govalle/landscaping')).toBe(false)
  })
})
