import { describe, expect, it } from 'vitest'
import {
  deliverableMembershipOf,
  deliverableRefMarker,
  deliverableRefsOf,
  deliverableTagsOf,
  liveDeliverables
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
})
