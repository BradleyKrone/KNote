// listDrag.ts — reordering whole list items (line + indented block) among
// their siblings, by drag or Alt+↑/↓. Pure EditorState logic; the grip and
// pointer gesture are DOM-only and checked in the dev host.

import { EditorSelection, EditorState } from '@codemirror/state'
import { codeFolding, foldEffect, foldedRanges } from '@codemirror/language'
import { describe, expect, it } from 'vitest'
import { moveItem, moveItemDown, moveItemUp, siblingItems } from '@/editor/listDrag'

function mkState(doc: string, cursorLine = 1): EditorState {
  const state = EditorState.create({ doc, extensions: [codeFolding()] })
  return state.update({ selection: EditorSelection.cursor(state.doc.line(cursorLine).from) }).state
}

function run(cmd: typeof moveItemUp, state: EditorState): { handled: boolean; state: EditorState } {
  let next = state
  const handled = cmd({ state, dispatch: (tr) => (next = tr.state) })
  return { handled, state: next }
}

const TASKS = [
  '# Today', // 1
  '- [ ] @task first', // 2
  '  - Notes: a', // 3
  '  - [ ] @task nested', // 4
  '    - deep', // 5
  '- [ ] @task second', // 6
  '- [ ] @task third', // 7
  '  - Notes: c', // 8
  '', // 9
  'Paragraph after.' // 10
].join('\n')

describe('siblingItems', () => {
  it('finds same-indent items with their blocks, stopping at a heading and a paragraph', () => {
    expect(siblingItems(mkState(TASKS), 6)).toEqual([
      { first: 2, last: 5 },
      { first: 6, last: 6 },
      { first: 7, last: 8 }
    ])
  })

  it('stays inside the parent for a nested item', () => {
    expect(siblingItems(mkState(TASKS), 4)).toEqual([
      { first: 3, last: 3 },
      { first: 4, last: 5 }
    ])
  })

  it('is empty on a non-list line', () => {
    expect(siblingItems(mkState(TASKS), 1)).toEqual([])
  })
})

describe('moveItem', () => {
  it('moves an item with its whole block (nested @task included)', () => {
    const state = mkState(TASKS)
    const sibs = siblingItems(state, 2)
    const spec = moveItem(state, sibs, 0, 3)!
    expect(state.update(spec).state.doc.toString()).toBe(
      [
        '# Today',
        '- [ ] @task second',
        '- [ ] @task third',
        '  - Notes: c',
        '- [ ] @task first',
        '  - Notes: a',
        '  - [ ] @task nested',
        '    - deep',
        '',
        'Paragraph after.'
      ].join('\n')
    )
  })

  it('is a no-op for the slots on either side of the item', () => {
    const state = mkState(TASKS)
    const sibs = siblingItems(state, 6)
    expect(moveItem(state, sibs, 1, 1)).toBeNull()
    expect(moveItem(state, sibs, 1, 2)).toBeNull()
  })

  it('handles the last item when the doc has no trailing newline', () => {
    const state = mkState('- a\n- b\n  - b child')
    const spec = moveItem(state, siblingItems(state, 1), 1, 0)!
    expect(state.update(spec).state.doc.toString()).toBe('- b\n  - b child\n- a')
  })

  it('keeps blank lines between items where they were', () => {
    const state = mkState('- a\n\n- b\n\n- c')
    const spec = moveItem(state, siblingItems(state, 1), 2, 0)!
    expect(state.update(spec).state.doc.toString()).toBe('- c\n\n- a\n\n- b')
  })

  it('leaves numbered list numbers alone', () => {
    const state = mkState('1. one\n2. two')
    const spec = moveItem(state, siblingItems(state, 1), 0, 2)!
    expect(state.update(spec).state.doc.toString()).toBe('2. two\n1. one')
  })

  it("carries a folded item's fold to its new position", () => {
    let state = mkState('- a\n  - a1\n  - a2\n- b')
    const a = state.doc.line(1)
    state = state.update({ effects: foldEffect.of({ from: a.to, to: state.doc.line(3).to }) }).state
    const spec = moveItem(state, siblingItems(state, 1), 0, 2)!
    const next = state.update(spec).state
    expect(next.doc.toString()).toBe('- b\n- a\n  - a1\n  - a2')
    const folds: [number, number][] = []
    foldedRanges(next).between(0, next.doc.length, (f, t) => {
      folds.push([f, t])
    })
    expect(folds).toEqual([[next.doc.line(2).to, next.doc.line(4).to]])
  })
})

describe('Alt+↑/↓', () => {
  it('swaps the item under the cursor with its neighbour and keeps the cursor on it', () => {
    const { handled, state } = run(moveItemUp, mkState(TASKS, 7))
    expect(handled).toBe(true)
    expect(state.doc.line(6).text).toBe('- [ ] @task third')
    expect(state.doc.line(7).text).toBe('  - Notes: c')
    expect(state.doc.line(8).text).toBe('- [ ] @task second')
    expect(state.doc.lineAt(state.selection.main.head).number).toBe(6)
  })

  it("moves down past a sibling's whole block", () => {
    const { state } = run(moveItemDown, mkState('- a\n- b\n  - b1'))
    expect(state.doc.toString()).toBe('- b\n  - b1\n- a')
  })

  it('consumes the key at the edge of the list without changing anything', () => {
    const before = mkState(TASKS, 2)
    const { handled, state } = run(moveItemUp, before)
    expect(handled).toBe(true)
    expect(state.doc.toString()).toBe(TASKS)
  })

  it('falls through to the default line move on a non-list line', () => {
    expect(run(moveItemUp, mkState(TASKS, 10)).handled).toBe(false)
  })
})
