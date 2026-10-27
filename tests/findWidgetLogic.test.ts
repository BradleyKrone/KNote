import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { SearchQuery } from '@codemirror/search'
import { countMatches, formatCount } from '@/editor/findWidgetLogic'

function stateWith(doc: string, from = 0, to = from): EditorState {
  return EditorState.create({ doc, selection: EditorSelection.single(from, to) })
}

describe('countMatches', () => {
  const doc = 'Cat cat concat cat'

  it('counts case-insensitively by default', () => {
    const q = new SearchQuery({ search: 'cat' })
    expect(countMatches(stateWith(doc), q)).toEqual({ total: 4, current: 0, capped: false })
  })

  it('reports which match the main selection sits on', () => {
    const q = new SearchQuery({ search: 'cat' })
    expect(countMatches(stateWith(doc, 4, 7), q).current).toBe(2)
    // A selection that only overlaps a match isn't "on" it.
    expect(countMatches(stateWith(doc, 4, 6), q).current).toBe(0)
  })

  it('honors match case, whole word and regex', () => {
    expect(
      countMatches(stateWith(doc), new SearchQuery({ search: 'cat', caseSensitive: true })).total
    ).toBe(3)
    expect(
      countMatches(stateWith(doc), new SearchQuery({ search: 'cat', wholeWord: true })).total
    ).toBe(3)
    expect(
      countMatches(stateWith(doc), new SearchQuery({ search: 'c[a-z]+t', regexp: true })).total
    ).toBe(4)
  })

  it('finds nothing for an empty or invalid query', () => {
    expect(countMatches(stateWith(doc), new SearchQuery({ search: '' })).total).toBe(0)
    expect(countMatches(stateWith(doc), new SearchQuery({ search: '(', regexp: true })).total).toBe(
      0
    )
  })

  it('stops at the limit and flags it', () => {
    const q = new SearchQuery({ search: 'a' })
    expect(countMatches(stateWith('a'.repeat(20)), q, 5)).toEqual({
      total: 5,
      current: 0,
      capped: true
    })
    expect(countMatches(stateWith('a'.repeat(5)), q, 5).capped).toBe(false)
  })
})

describe('formatCount', () => {
  const q = new SearchQuery({ search: 'x' })

  it('is blank for an empty query', () => {
    expect(
      formatCount(new SearchQuery({ search: '' }), { total: 0, current: 0, capped: false })
    ).toBe('')
  })

  it('reads like VS Code', () => {
    expect(formatCount(q, { total: 0, current: 0, capped: false })).toBe('No results')
    expect(formatCount(q, { total: 12, current: 3, capped: false })).toBe('3 of 12')
    expect(formatCount(q, { total: 12, current: 0, capped: false })).toBe('? of 12')
    expect(formatCount(q, { total: 1000, current: 1, capped: true })).toBe('1 of 1000+')
  })
})
