// foldPersist.ts — the round trip that lets a note reopen with the same
// sections collapsed: reading back which lines are folded by their trimmed
// text (foldedLineKeys), then re-deriving the same fold ranges on a fresh
// EditorState built from the same doc text (foldEffectsFor). Covers both
// fold sources the live-preview editor has: taskFold's indentation-based
// folding and the markdown language's own heading folding.

import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree, foldEffect, foldable, foldedRanges } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { describe, expect, it } from 'vitest'
import { FOLD_PARSE_MS, foldedLineKeys, foldEffectsFor } from '@/editor/foldPersist'
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

// A heading has no more-indented children, so taskFold's foldService declines it
// and `foldable` falls through to the markdown language's own folding — which
// reads the syntax tree and returns null for anything past the parsed prefix
// (`syntaxFolding`: `if (tree.length < end) return null`). A fresh EditorState is
// parsed only to Work.InitViewport (3000 chars), so a caller that resolves saved
// keys against a just-created state silently drops every heading fold below that
// mark. Task folds are unaffected — which is why only long notes appeared to
// forget their collapsed sections.
describe('foldPersist past the initial parse window', () => {
  const SECTIONS = 8

  /** Headings spaced ~750 chars apart, so most of them land past 3000. */
  function longDoc(): string {
    const lines: string[] = []
    for (let s = 1; s <= SECTIONS; s++) {
      lines.push(`# Section ${s}`)
      for (let i = 0; i < 12; i++) {
        lines.push('lorem ipsum dolor sit amet consectetur adipiscing elit sed do')
      }
      lines.push('')
    }
    return lines.join('\n')
  }

  const DOC_LONG = longDoc()
  const headingKeys = Array.from({ length: SECTIONS }, (_, i) => `# Section ${i + 1}`)

  const mkLongState = (): EditorState =>
    EditorState.create({ doc: DOC_LONG, extensions: [markdown(), taskFold] })

  /**
   * What `forceParsing` does internally: extend the parse context, then dispatch
   * so the Language StateField publishes the longer tree (`syntaxTree` reads the
   * field, so `ensureSyntaxTree` alone is not enough). `applyFoldedLineKeys`
   * calls `forceParsing` on the real view; this is the EditorState-level
   * equivalent, since vitest runs under node and has no DOM to host a view.
   */
  function fullyParsed(state: EditorState): EditorState {
    ensureSyntaxTree(state, state.doc.length, FOLD_PARSE_MS)
    return state.update({}).state
  }

  it('cannot resolve headings past the parse frontier of a freshly created state', () => {
    expect(DOC_LONG.length).toBeGreaterThan(3000)
    const fresh = mkLongState()
    // Not a desired behavior — the hazard applyFoldedLineKeys exists to work
    // around. If CodeMirror ever parses eagerly this assertion is what tells us.
    expect(foldEffectsFor(fresh, headingKeys).length).toBeLessThan(SECTIONS)
  })

  it('restores every heading fold once the document is fully parsed', () => {
    const parsed = fullyParsed(mkLongState())

    let folded = parsed
    for (const key of headingKeys) {
      const n = folded.doc.toString().slice(0, folded.doc.length).split('\n').indexOf(key) + 1
      const line = folded.doc.line(n)
      const range = foldable(folded, line.from, line.to)
      if (!range) throw new Error(`${key} is not foldable`)
      folded = folded.update({ effects: foldEffect.of(range) }).state
    }
    expect(foldedLineKeys(folded)).toEqual(headingKeys)

    const restored = parsed.update({ effects: foldEffectsFor(parsed, headingKeys) }).state
    expect(rangesOf(restored)).toEqual(rangesOf(folded))
  })
})
