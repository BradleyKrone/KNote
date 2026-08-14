// foldPersist.ts — the round trip that lets a note reopen with the same
// sections collapsed: reading back which lines are folded by their trimmed
// text (foldedLineKeys), then re-deriving the same fold ranges on a fresh
// EditorState built from the same doc text (foldEffectsFor). Covers both
// fold sources the live-preview editor has: taskFold's indentation-based
// folding and the markdown language's own heading folding.

import { EditorState } from '@codemirror/state'
import { foldEffect, foldable, foldedRanges } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { describe, expect, it } from 'vitest'
import { foldedLineKeys, foldEffectsFor } from '@/editor/foldPersist'
import { taskFold } from '@/editor/taskFold'

const DOC = [
  '# Section One', // 1
  'intro para', // 2
  '', // 3
  '- [ ] task one', // 4
  '  - Status Changed: n/a', // 5
  '  - Date Entered: 8/13/2026', // 6
  '', // 7
  '# Section Two', // 8
  'more text' // 9
].join('\n')

function mkState(): EditorState {
  return EditorState.create({ doc: DOC, extensions: [markdown(), taskFold] })
}

function fold(state: EditorState, lineNumber: number): EditorState {
  const line = state.doc.line(lineNumber)
  const range = foldable(state, line.from, line.to)
  if (!range) throw new Error(`line ${lineNumber} is not foldable`)
  return state.update({ effects: foldEffect.of(range) }).state
}

function rangesOf(state: EditorState): Array<[number, number]> {
  const out: Array<[number, number]> = []
  foldedRanges(state).between(0, state.doc.length, (from, to) => out.push([from, to]))
  return out.sort((a, b) => a[0] - b[0])
}

describe('foldPersist round trip', () => {
  it('restores both a heading fold and a task-detail fold from their saved keys', () => {
    let folded = mkState()
    folded = fold(folded, 1) // heading
    folded = fold(folded, 4) // task detail

    const keys = foldedLineKeys(folded)
    expect(keys).toEqual(['# Section One', '- [ ] task one'])

    const fresh = mkState()
    const restored = fresh.update({ effects: foldEffectsFor(fresh, keys) }).state

    expect(rangesOf(restored)).toEqual(rangesOf(folded))
  })

  it('produces no effects for an already-unfolded document with no saved keys', () => {
    expect(foldEffectsFor(mkState(), [])).toEqual([])
  })

  it('matches a saved key against only as many identical-text lines as were folded', () => {
    const doc = [
      '- [ ] dup', // 1
      '  - a', // 2
      '- [ ] dup', // 3
      '  - b' // 4
    ].join('\n')
    const state = EditorState.create({ doc, extensions: [markdown(), taskFold] })

    // Only the first "dup" was folded.
    const keys = ['- [ ] dup']
    const restored = state.update({ effects: foldEffectsFor(state, keys) }).state

    expect(rangesOf(restored)).toEqual([[state.doc.line(1).to, state.doc.line(2).to]])
  })
})
