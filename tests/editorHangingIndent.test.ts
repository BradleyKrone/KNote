import { describe, expect, it } from 'vitest'
import { hangingIndentEm } from '@/editor/hangingIndent'

// The em constants hangingIndent.ts is built from, restated so a change to one
// of them shows up here as a deliberate edit rather than a silent drift.
const SPACE = 0.274
const BULLET = 0.422
const DASH = 0.4
const DIGIT = 0.539
const DOT = 0.217
const PAREN = 0.302
const CHECKBOX = 0.85 * 1.3

describe('hangingIndentEm', () => {
  it('returns null for lines that need no hang', () => {
    expect(hangingIndentEm('just prose')).toBeNull()
    expect(hangingIndentEm('# A heading')).toBeNull()
    expect(hangingIndentEm('')).toBeNull()
    expect(hangingIndentEm('   ')).toBeNull() // whitespace-only can't wrap
  })

  it('measures a plain indented line by its leading whitespace alone', () => {
    const two = hangingIndentEm('  a note under a task')
    expect(two).toBeCloseTo(2 * SPACE, 3)
    expect(hangingIndentEm('    deeper')).toBeCloseTo(4 * SPACE, 3)
  })

  it('adds the bullet and its trailing space for an unordered list', () => {
    expect(hangingIndentEm('- item')).toBeCloseTo(BULLET + SPACE, 3)
    expect(hangingIndentEm('  - Status Changed: 1/2/2026')).toBeCloseTo(
      2 * SPACE + BULLET + SPACE,
      3
    )
    // The rendered `•` is the same width whichever marker was typed.
    expect(hangingIndentEm('* item')).toEqual(hangingIndentEm('- item'))
    expect(hangingIndentEm('+ item')).toEqual(hangingIndentEm('- item'))
  })

  it('widens an ordered marker with its digit count and punctuation', () => {
    const one = hangingIndentEm('1. item') as number
    expect(one).toBeCloseTo(DIGIT + DOT + SPACE, 3)
    expect((hangingIndentEm('10. item') as number) - one).toBeCloseTo(DIGIT, 3)
    expect((hangingIndentEm('1) item') as number) - one).toBeCloseTo(PAREN - DOT, 3)
  })

  it('accounts for the checkbox widget on a task line', () => {
    const task = hangingIndentEm('- [ ] do the thing') as number
    expect(task).toBeCloseTo(DASH + SPACE + CHECKBOX + SPACE, 3)
    // A task keeps its literal `-`, so it is not the bullet width.
    expect(task).toBeGreaterThan(hangingIndentEm('- do the thing') as number)
    // Every status char, and a deeper subtask, are the same shape.
    expect(hangingIndentEm('- [x] done')).toEqual(task)
    expect(hangingIndentEm('- [a] archived')).toEqual(task)
    expect((hangingIndentEm('  - [ ] subtask') as number) - task).toBeCloseTo(2 * SPACE, 3)
  })

  it('expands a tab to the next multiple of 4, matching CSS tab-size', () => {
    expect(hangingIndentEm('\tnote')).toBeCloseTo(4 * SPACE, 3)
    expect(hangingIndentEm('  \tnote')).toBeCloseTo(4 * SPACE, 3)
    expect(hangingIndentEm('\t\tnote')).toBeCloseTo(8 * SPACE, 3)
  })
})
