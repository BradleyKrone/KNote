// enclosingGroupLastLine (taskFold.ts) — whether a table's own line range
// falls inside a top-level task's group card, and whether it closes it.
//
// The regression this covers: a rendered table replaces its lines with one
// block widget, so it never gets buildGroupBoxes's per-line decorations the
// way the task's checkbox line and metadata bullets do — this is the
// backward-scanning lookup tableRender.ts uses instead to draw the same
// border on the table's own wrapper. Pure line-text logic, no markdown
// parsing or DOM involved, so it's covered directly here.

import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { enclosingGroupLastLine } from '@/editor/taskFold'
import { editorKind } from '@/editor/editorMode'

function mkState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [editorKind.of('note')] })
}

const NOTE = [
  '- [ ] create new task', // 1
  '  - Status Changed: n/a', // 2
  '  - Date Entered: 8/12/2026', // 3
  '  - things to do', // 4
  '  - ', // 5
  '  | Column 1 | Column 2 | Column 3 |', // 6
  '  | --- | --- | --- |', // 7
  '  |  |  |  |', // 8
  '  |  |  |  |', // 9
  '', // 10
  '- [ ] a later task', // 11
  '  - Status Changed: n/a' // 12
].join('\n')

describe('enclosingGroupLastLine', () => {
  it('includes a table indented right under the task, ending the group', () => {
    for (const line of [6, 7, 8, 9]) {
      expect(enclosingGroupLastLine(mkState(NOTE), line)).toBe(9)
    }
  })

  it('returns null for a flush-left table with no enclosing task', () => {
    const doc = ['prose', '', '| A | B |', '| - | - |', '| 1 | 2 |'].join('\n')
    expect(enclosingGroupLastLine(mkState(doc), 3)).toBeNull()
  })

  it('spans a blank line between the metadata bullets and the table', () => {
    const doc = [
      '- [ ] task', // 1
      '  - Status Changed: n/a', // 2
      '', // 3 blank, from insertTableAt padding
      '  | A | B |', // 4
      '  | - | - |', // 5
      '  | 1 | 2 |' // 6
    ].join('\n')
    expect(enclosingGroupLastLine(mkState(doc), 4)).toBe(6)
    expect(enclosingGroupLastLine(mkState(doc), 6)).toBe(6)
  })

  it('does not attribute a table to an earlier, unrelated task', () => {
    // The table (line 12) sits under the SECOND task, not the first.
    const doc = [
      '- [ ] first task', // 1
      '  - Status Changed: n/a', // 2
      '', // 3
      '- [ ] second task', // 4
      '  - Status Changed: n/a', // 5
      '  | A | B |', // 6
      '  | - | - |', // 7
      '  | 1 | 2 |' // 8
    ].join('\n')
    expect(enclosingGroupLastLine(mkState(doc), 6)).toBe(8)
    expect(enclosingGroupLastLine(mkState(doc), 8)).toBe(8)
  })

  it('breaks the chain at a flush-left line that is not a task', () => {
    const doc = [
      '- [ ] task', // 1
      '  notes', // 2
      'a flush-left paragraph', // 3
      '  | A | B |', // 4
      '  | - | - |', // 5
      '  | 1 | 2 |' // 6
    ].join('\n')
    expect(enclosingGroupLastLine(mkState(doc), 4)).toBeNull()
  })

  it('is not the last line when more indented content follows the table', () => {
    const doc = [
      '- [ ] task', // 1
      '  | A | B |', // 2
      '  | - | - |', // 3
      '  | 1 | 2 |', // 4
      '  - a trailing note' // 5
    ].join('\n')
    expect(enclosingGroupLastLine(mkState(doc), 2)).toBe(5)
    expect(enclosingGroupLastLine(mkState(doc), 4)).toBe(5)
  })

  it('only counts a top-level task, not an indented sub-task, as the anchor', () => {
    // A fragment-mode editor (a task's own detached body) never has a
    // top-level task, so nothing anchors a card at all.
    const state = EditorState.create({
      doc: NOTE,
      extensions: [editorKind.of('fragment')]
    })
    expect(enclosingGroupLastLine(state, 6)).toBeNull()
  })

  it('returns null for a line before any content', () => {
    expect(enclosingGroupLastLine(mkState(NOTE), 1)).toBeNull()
  })
})
