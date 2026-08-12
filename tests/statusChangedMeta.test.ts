import { describe, expect, it } from 'vitest'
import {
  ownNoteBlockEnd,
  planTaskMetaEdit,
  taskBlockEnd,
  taskBlockLines
} from '@shared/parser/patterns'

/**
 * The live-buffer path is where the duplicate `Status Changed` line showed
 * up. Both write paths (the extension host's WorkspaceEdit translation in
 * verifiedEdit.ts and core/lineEdit's disk rewrite) consume the shared
 * `planTaskMetaEdit` splice; apply it to a document and assert the text.
 */
function applyMeta(
  text: string,
  taskLineNumber: number,
  updates: { reasonLine?: string | null; statusChangedLine?: string; blockLines?: string[] }
): string {
  const lines = text.split('\n')
  const plan = planTaskMetaEdit(lines, taskLineNumber - 1, updates)
  lines.splice(plan.start, plan.deleteCount, ...plan.insert)
  return lines.join('\n')
}

/** A task whose block holds a fence containing a checkbox-looking line. */
const fenced =
  '- [ ] t\n  - Notes: see below\n  ```sh\n  - [ ] not a task\n  echo hi\n  ```\nnext\n'

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
describe('planTaskMetaEdit blockLines (task-note editing)', () => {
  const seeded =
    '- [ ] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/1/2026\n  - Notes: original\n  - more\nnext\n'

  it('leaves the body byte-identical when blockLines is omitted', () => {
    // Regression pin for every pre-existing caller: a status change must not
    // touch the note body, and must not hoist Date Entered out of it either.
    expect(applyMeta(seeded, 1, { statusChangedLine: '  - Status Changed: 7/20/2026' })).toBe(
      '- [ ] task\n  - Status Changed: 7/20/2026\n  - Date Entered: 7/1/2026\n  - Notes: original\n  - more\nnext\n'
    )
  })

  it('replaces the body while keeping the status and Date Entered lines', () => {
    expect(applyMeta(seeded, 1, { blockLines: ['  - Notes: rewritten', '  - and again'] })).toBe(
      '- [ ] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/1/2026\n  - Notes: rewritten\n  - and again\nnext\n'
    )
  })

  it('keeps the reason line too, in canonical order', () => {
    const out = applyMeta(
      '- [w] task\n  Reason for Waiting: parts ⏳ 2026-08-04\n  - Status Changed: 7/1/2026\n  - Date Entered: 6/1/2026\n  - Notes: old\n',
      1,
      { blockLines: ['  - Notes: new'] }
    )
    expect(out).toBe(
      '- [w] task\n  Reason for Waiting: parts ⏳ 2026-08-04\n  - Status Changed: 7/1/2026\n  - Date Entered: 6/1/2026\n  - Notes: new\n'
    )
  })

  it('clears the body down to the managed lines on an empty array', () => {
    expect(applyMeta(seeded, 1, { blockLines: [] })).toBe(
      '- [ ] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/1/2026\nnext\n'
    )
  })

  it('plans a pure insert for a task that has no note block at all', () => {
    const plan = planTaskMetaEdit(['- [ ] bare', 'next'], 0, {
      blockLines: ['  - Notes: brand new']
    })
    expect(plan).toEqual({ start: 1, deleteCount: 0, insert: ['  - Notes: brand new'] })
  })

  it('leaves nothing behind when a task with only a body has it cleared', () => {
    const plan = planTaskMetaEdit(['- [ ] t', '  - Notes: gone', 'next'], 0, { blockLines: [] })
    expect(plan).toEqual({ start: 1, deleteCount: 1, insert: [] })
  })

  it('drops managed-looking lines a user typed into the notes box', () => {
    // Otherwise the next parse would promote these to the real stamps and
    // clobber them. They are read-only in the editor; this is the enforcement.
    const out = applyMeta(seeded, 1, {
      blockLines: [
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
      { blockLines: ['  - Notes: new'] }
    )
    expect(out).toBe(
      '- [ ] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/1/2026\n  - Notes: new\n'
    )
  })

  it('trims blank lines off both ends of a replacement body', () => {
    const out = applyMeta(seeded, 1, { blockLines: ['', '  - Notes: a', '', '  - b', ''] })
    expect(out).toBe(
      '- [ ] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/1/2026\n  - Notes: a\n\n  - b\nnext\n'
    )
  })

  const withChild = '- [ ] parent\n  - Notes: mine\n  - [ ] child\n    - Notes: theirs\n'

  it('reaches the whole subtree when a body is supplied — sub-tasks are the editor’s to rewrite', () => {
    const out = applyMeta(withChild, 1, { blockLines: ['  - Notes: replaced'] })
    expect(out).toBe('- [ ] parent\n  - Notes: replaced\n')
  })

  it('stops before a nested sub-task when no body is supplied — a status change must never reach one', () => {
    const out = applyMeta(withChild, 1, { statusChangedLine: '  - Status Changed: 7/1/2026' })
    expect(out).toBe(
      '- [ ] parent\n  - Status Changed: 7/1/2026\n  - Notes: mine\n  - [ ] child\n    - Notes: theirs\n'
    )
  })

  it('keeps a sub-task’s own Status Changed / Date Entered in a replacement body', () => {
    // The managed-line filter only applies above the body's first checkbox:
    // past it the stamps are the sub-task's, and stripping them would wipe them
    // on every save.
    const body = [
      '  - Notes: parent',
      '  - [ ] child',
      '    - Status Changed: 7/2/2026',
      '    - Date Entered: 7/1/2026'
    ]
    expect(applyMeta(seeded, 1, { blockLines: body })).toBe(
      '- [ ] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/1/2026\n' +
        body.join('\n') +
        '\nnext\n'
    )
  })

  it('deletes the whole subtree when the body is cleared', () => {
    const plan = planTaskMetaEdit(withChild.split('\n'), 0, { blockLines: [] })
    expect(plan).toEqual({ start: 1, deleteCount: 3, insert: [] })
  })

  it('round-trips: replacing a block with the one just read is a no-op', () => {
    // The strongest guarantee in this file — the parser reading a block out and
    // the planner writing one back have to reach the same answer, or the board
    // shows one thing and overwrites another.
    for (const doc of [seeded, withChild, fenced, '- [ ] bare\nnext\n']) {
      const lines = doc.split('\n')
      expect(applyMeta(doc, 1, { blockLines: taskBlockLines(lines, 0) })).toBe(doc)
    }
  })
})

describe('taskBlockEnd / taskBlockLines (the wide block)', () => {
  it('takes in a nested sub-task and everything under it', () => {
    const lines = ['- [ ] parent', '  - Status Changed: 7/1/2026', '  - [ ] child', '    - x']
    expect(taskBlockEnd(lines, 0, 0)).toBe(4)
    // The parent's own managed line drops out; the child's content stays.
    expect(taskBlockLines(lines, 0)).toEqual(['  - [ ] child', '    - x'])
  })

  it('keeps a descendant’s own managed lines but not the task’s own', () => {
    const lines = [
      '- [ ] parent',
      '  - Status Changed: 7/1/2026',
      '  - [ ] child',
      '    - Status Changed: 7/2/2026'
    ]
    expect(taskBlockLines(lines, 0)).toEqual(['  - [ ] child', '    - Status Changed: 7/2/2026'])
  })

  it('stops at a sibling task rather than swallowing the rest of the file', () => {
    const lines = ['- [ ] a', '  - note', '- [ ] b', '  - other']
    expect(taskBlockEnd(lines, 0, 0)).toBe(2)
  })

  it('stops at a heading or paragraph back at the task’s own indent', () => {
    expect(taskBlockEnd(['- [ ] a', '  - note', '## Later'], 0, 0)).toBe(2)
    expect(taskBlockEnd(['- [ ] a', '  - note', 'prose'], 0, 0)).toBe(2)
  })

  it('carries a fenced block through, fake checkboxes and all', () => {
    const lines = fenced.split('\n')
    expect(taskBlockLines(lines, 0)).toEqual([
      '  - Notes: see below',
      '  ```sh',
      '  - [ ] not a task',
      '  echo hi',
      '  ```'
    ])
  })

  it('ends the block at an unterminated fence rather than eating the file', () => {
    const lines = ['- [ ] t', '  - Notes: real', '  ```sh', '  echo hi']
    expect(taskBlockEnd(lines, 0, 0)).toBe(2)
  })

  it('backs out of a fence whose content dedents out of the list item', () => {
    // Dedented past the fence's own column, CommonMark (and so remark's mask,
    // and so the parser's task detection) reads `- [ ] real task` as a genuine
    // top-level task. Sweeping it in here would put one line on two cards, and
    // the next save of this one would delete it.
    const lines = ['- [ ] t', '  - Notes: real', '  ```sh', '- [ ] real task', '  ```']
    expect(taskBlockEnd(lines, 0, 0)).toBe(2)
  })

  it('excludes trailing blanks', () => {
    expect(taskBlockEnd(['- [ ] t', '  - a', '', ''], 0, 0)).toBe(2)
  })

  it('handles a subtree that runs to the end of the file', () => {
    const lines = ['- [ ] t', '  - [ ] child', '    - deep']
    expect(taskBlockEnd(lines, 0, 0)).toBe(3)
  })

  it('keeps a tab-indented subtree verbatim', () => {
    const lines = ['- [ ] t', '\t- [ ] child', '\t\t- deep']
    expect(taskBlockLines(lines, 0)).toEqual(['\t- [ ] child', '\t\t- deep'])
  })
})
