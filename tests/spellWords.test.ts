import { describe, expect, it } from 'vitest'
import { findMisspellings } from '../src/webviews/shared/spellcheck/spellWords'

// A stand-in dictionary: everything in KNOWN is spelled right.
const KNOWN = new Set(['ship', 'the', 'release', 'see', 'notes', 'at', 'it', "don't"])
const isCorrect = (w: string): boolean => KNOWN.has(w.toLowerCase())
const words = (text: string, skip?: Array<[number, number]>): string[] =>
  findMisspellings(text, isCorrect, skip).map((s) => s.word)

describe('findMisspellings', () => {
  it('flags an unknown word with its offsets', () => {
    expect(findMisspellings('ship testse', isCorrect)).toEqual([
      { from: 5, to: 11, word: 'testse' }
    ])
  })

  it('keeps internal apostrophes and ignores case', () => {
    expect(words("Don't ship")).toEqual([])
  })

  it('skips camelCase, acronyms and single letters', () => {
    expect(words('ship KNote GitHub USA x')).toEqual([])
  })

  it('skips words touching digits, underscores, slashes or @', () => {
    expect(words('test2 snake_case a/bcd name@host')).toEqual([])
  })

  it('skips #tags, [[wiki links]] and URLs', () => {
    expect(words('see #projx [[Somenote]] at https://exampel.com/pagez')).toEqual([])
  })

  it('honours extra skip ranges', () => {
    expect(words('qwzx ship', [[0, 4]])).toEqual([])
  })

  it('judges a word at the slice edge by the character outside it', () => {
    expect(findMisspellings('qwzx', isCorrect, [], { before: '_' })).toEqual([])
    expect(findMisspellings('qwzx', isCorrect, [], { after: ' ' })).toHaveLength(1)
  })
})
