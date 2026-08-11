import { describe, expect, it } from 'vitest'
import { planTaskMetaEdit, ownNoteBlockEnd } from '@shared/parser/patterns'

/**
 * The live-buffer path is where the duplicate `Status Changed` line showed
 * up. Both write paths (the extension host's WorkspaceEdit translation in
 * verifiedEdit.ts and core/lineEdit's disk rewrite) consume the shared
 * `planTaskMetaEdit` splice; apply it to a document and assert the text.
 */
function applyMeta(
  text: string,
  taskLineNumber: number,
  updates: { reasonLine?: string | null; statusChangedLine?: string; noteLines?: string[] }
): string {
  const lines = text.split('\n')
  const plan = planTaskMetaEdit(lines, taskLineNumber - 1, updates)
  lines.splice(plan.start, plan.deleteCount, ...plan.insert)
  return lines.join('\n')
}

describe('planTaskMetaEdit / ownNoteBlockEnd', () => {
  it('bounds a task note block at the first nested checkbox', () => {
    const lines = ['- [ ] parent', '  - Status Changed: 7/1/2026', '  - [ ] child', '    - x']
    expect(ownNoteBlockEnd(lines, 0, 0)).toBe(2) // stops before the child checkbox
  })

  it('finds a status line past a blank line and dedupes extras', () => {
    const lines = [
      '- [/] task',
      '  - Status Changed: 7/13/2026',
      '',
      '  - Status Changed: 7/10/2026',
      '  - Date Entered: 7/13/2026'
    ]
    const plan = planTaskMetaEdit(lines, 0, { statusChangedLine: '  - Status Changed: 7/15/2026' })
    expect(plan.insert.filter((l) => l.includes('Status Changed:'))).toEqual([
      '  - Status Changed: 7/15/2026'
    ])
  })
})

describe('planTaskMetaEdit applied to a document', () => {
  it('updates a seeded n/a status line in place', () => {
    const out = applyMeta(
      '- [ ] task\n  - Status Changed: n/a\n  - Date Entered: 7/13/2026\n  - Notes: \n',
      1,
      { statusChangedLine: '  - Status Changed: 7/14/2026' }
    )
    expect(out).toBe(
      '- [ ] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/13/2026\n  - Notes: \n'
    )
  })

  it('reproduces the screenshot: blank line above status → still updated in place, no new line', () => {
    const out = applyMeta(
      '- [/] task\n\n  - Status Changed: 7/10/2026\n  - Date Entered: 7/13/2026\n  - Notes: \n',
      1,
      { statusChangedLine: '  - Status Changed: 7/14/2026' }
    )
    expect((out.match(/Status Changed:/g) || []).length).toBe(1)
    expect(out).toContain('- Status Changed: 7/14/2026')
    expect(out).toContain('- Date Entered: 7/13/2026')
  })

  it('collapses an already-duplicated status block to one line', () => {
    const out = applyMeta(
      '- [/] task\n  - Status Changed: 7/13/2026\n\n  - Status Changed: 7/10/2026\n  - Date Entered: 7/13/2026\n',
      1,
      { statusChangedLine: '  - Status Changed: 7/15/2026' }
    )
    expect((out.match(/Status Changed:/g) || []).length).toBe(1)
    expect(out).toContain('- Status Changed: 7/15/2026')
  })

  it('inserts a status line under a task that has none', () => {
    const out = applyMeta('- [ ] task\nnext\n', 1, {
      statusChangedLine: '  - Status Changed: 7/14/2026'
    })
    expect(out).toBe('- [ ] task\n  - Status Changed: 7/14/2026\nnext\n')
  })

  it('heals a stray blank line between status and the note (no space added on move)', () => {
    const out = applyMeta(
      '- [ ] dc\n  - Status Changed: 7/13/2026\n\n\n  - Date Entered: 7/13/2026\n  - Notes: \n',
      1,
      { statusChangedLine: '  - Status Changed: 7/14/2026' }
    )
    expect(out).toBe(
      '- [ ] dc\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/13/2026\n  - Notes: \n'
    )
  })

  it('deletes the reason line on reasonLine: null, keeping the rest of the note', () => {
    const out = applyMeta(
      '- [w] task\n  Reason for Waiting: parts ⏳ 2026-08-04\n  - Status Changed: 7/1/2026\n  - Notes: keep\n',
      1,
      { reasonLine: null, statusChangedLine: '  - Status Changed: 7/14/2026' }
    )
    expect(out).toBe('- [w] task\n  - Status Changed: 7/14/2026\n  - Notes: keep\n')
    // Reason text and follow-up date share one line, so one splice takes both.
    expect(out).not.toContain('⏳')
    expect(out).not.toContain('2026-08-04')
  })

  it('clears every duplicate reason line, not just the first, in either marker', () => {
    const out = applyMeta(
      '- [w] task\n  Reason for Waiting: a ⏳ 2026-08-04\n  Reason for Waiting: b 📅 2026-07-02\n  - Date Entered: 7/1/2026\n',
      1,
      { reasonLine: null }
    )
    expect(out).toBe('- [w] task\n  - Date Entered: 7/1/2026\n')
  })

  it('plans an empty insert when the reason was the whole note block', () => {
    const plan = planTaskMetaEdit(
      ['- [w] task', '  Reason for Waiting: parts 📅 2026-07-01', 'next'],
      0,
      { reasonLine: null }
    )
    expect(plan).toEqual({ start: 1, deleteCount: 1, insert: [] })
  })

  it('preserves blank lines inside the user note body', () => {
    const out = applyMeta(
      '- [ ] dc\n  - Status Changed: 7/13/2026\n  - Date Entered: 7/13/2026\n  - Notes: one\n\n  two\n',
      1,
      { statusChangedLine: '  - Status Changed: 7/14/2026' }
    )
    expect(out).toContain('- Notes: one\n\n  two')
  })
})

/**
 * The note-body half of the same planner, driving the board's task editor.
 * The auto-managed lines are the planner's to carry over, never the caller's
 * to send — see `isManagedNoteLine`.
 */
describe('planTaskMetaEdit noteLines (task-note editing)', () => {
  const seeded =
    '- [ ] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/1/2026\n  - Notes: original\n  - more\nnext\n'

  it('leaves the body byte-identical when noteLines is omitted', () => {
    // Regression pin for every pre-existing caller: a status change must not
    // touch the note body, and must not hoist Date Entered out of it either.
    expect(applyMeta(seeded, 1, { statusChangedLine: '  - Status Changed: 7/20/2026' })).toBe(
      '- [ ] task\n  - Status Changed: 7/20/2026\n  - Date Entered: 7/1/2026\n  - Notes: original\n  - more\nnext\n'
    )
  })

  it('replaces the body while keeping the status and Date Entered lines', () => {
    expect(applyMeta(seeded, 1, { noteLines: ['  - Notes: rewritten', '  - and again'] })).toBe(
      '- [ ] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/1/2026\n  - Notes: rewritten\n  - and again\nnext\n'
    )
  })

  it('keeps the reason line too, in canonical order', () => {
    const out = applyMeta(
      '- [w] task\n  Reason for Waiting: parts ⏳ 2026-08-04\n  - Status Changed: 7/1/2026\n  - Date Entered: 6/1/2026\n  - Notes: old\n',
      1,
      { noteLines: ['  - Notes: new'] }
    )
    expect(out).toBe(
      '- [w] task\n  Reason for Waiting: parts ⏳ 2026-08-04\n  - Status Changed: 7/1/2026\n  - Date Entered: 6/1/2026\n  - Notes: new\n'
    )
  })

  it('clears the body down to the managed lines on an empty array', () => {
    expect(applyMeta(seeded, 1, { noteLines: [] })).toBe(
      '- [ ] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/1/2026\nnext\n'
    )
  })

  it('plans a pure insert for a task that has no note block at all', () => {
    const plan = planTaskMetaEdit(['- [ ] bare', 'next'], 0, {
      noteLines: ['  - Notes: brand new']
    })
    expect(plan).toEqual({ start: 1, deleteCount: 0, insert: ['  - Notes: brand new'] })
  })

  it('leaves nothing behind when a task with only a body has it cleared', () => {
    const plan = planTaskMetaEdit(['- [ ] t', '  - Notes: gone', 'next'], 0, { noteLines: [] })
    expect(plan).toEqual({ start: 1, deleteCount: 1, insert: [] })
  })

  it('drops managed-looking lines a user typed into the notes box', () => {
    // Otherwise the next parse would promote these to the real stamps and
    // clobber them. They are read-only in the editor; this is the enforcement.
    const out = applyMeta(seeded, 1, {
      noteLines: [
        '  - Status Changed: 1/1/2000',
        '  - Date Entered: 1/1/2000',
        '  Reason for Waiting: fake ⏳ 2026-01-01',
        '  - Notes: kept'
      ]
    })
    expect(out).toBe(
      '- [ ] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/1/2026\n  - Notes: kept\nnext\n'
    )
  })

  it('hoists a Date Entered line that sat below the prose, so replacing the body cannot lose it', () => {
    const out = applyMeta(
      '- [ ] task\n  - Status Changed: 7/14/2026\n  - Notes: old\n  - Date Entered: 7/1/2026\n',
      1,
      { noteLines: ['  - Notes: new'] }
    )
    expect(out).toBe(
      '- [ ] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/1/2026\n  - Notes: new\n'
    )
  })

  it('trims blank lines off both ends of a replacement body', () => {
    const out = applyMeta(seeded, 1, { noteLines: ['', '  - Notes: a', '', '  - b', ''] })
    expect(out).toBe(
      '- [ ] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/1/2026\n  - Notes: a\n\n  - b\nnext\n'
    )
  })

  it('stops at a nested sub-task, leaving it and its own notes alone', () => {
    const out = applyMeta(
      '- [ ] parent\n  - Notes: mine\n  - [ ] child\n    - Notes: theirs\n',
      1,
      { noteLines: ['  - Notes: replaced'] }
    )
    expect(out).toBe('- [ ] parent\n  - Notes: replaced\n  - [ ] child\n    - Notes: theirs\n')
  })
})
