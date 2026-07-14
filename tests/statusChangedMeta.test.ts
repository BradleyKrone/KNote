import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { planMetaChange } from '@/editor/formatting'
import { planTaskMetaEdit, ownNoteBlockEnd } from '@shared/parser/patterns'

/**
 * The editor (live-buffer) path is where the duplicate `Status Changed` line
 * showed up. `planMetaChange` translates the shared splice plan into a single
 * CodeMirror change; apply it to a real doc and assert the resulting text.
 */
function applyMeta(
  text: string,
  taskLineNumber: number,
  updates: { reasonLine?: string; statusChangedLine?: string }
): string {
  const state = EditorState.create({ doc: text })
  const change = planMetaChange(state.doc, taskLineNumber, updates)
  if (!change) return text
  return state.update({ changes: change }).state.doc.toString()
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

describe('planMetaChange (editor buffer path)', () => {
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

  it('preserves blank lines inside the user note body', () => {
    const out = applyMeta(
      '- [ ] dc\n  - Status Changed: 7/13/2026\n  - Date Entered: 7/13/2026\n  - Notes: one\n\n  two\n',
      1,
      { statusChangedLine: '  - Status Changed: 7/14/2026' }
    )
    expect(out).toContain('- Notes: one\n\n  two')
  })
})
