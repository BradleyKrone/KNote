import { describe, expect, it } from 'vitest'
import { parseSearchQuery } from '@shared/searchQuery'

describe('parseSearchQuery', () => {
  it('parses plain terms', () => {
    expect(parseSearchQuery('hello world')).toMatchObject({ terms: ['hello', 'world'] })
  })

  it('parses quoted phrases', () => {
    expect(parseSearchQuery('"exact phrase" loose')).toMatchObject({
      phrases: ['exact phrase'],
      terms: ['loose']
    })
  })

  it('parses exclusions', () => {
    expect(parseSearchQuery('keep -drop')).toMatchObject({ terms: ['keep'], excludes: ['drop'] })
  })

  it('parses operators', () => {
    const q = parseSearchQuery('path:Work file:daily tag:#project term')
    expect(q.path).toEqual(['Work'])
    expect(q.file).toEqual(['daily'])
    expect(q.tag).toEqual(['project'])
    expect(q.terms).toEqual(['term'])
  })

  it('strips # from tag operator and supports quoted operator values', () => {
    const q = parseSearchQuery('tag:plain path:"My Folder"')
    expect(q.tag).toEqual(['plain'])
    expect(q.path).toEqual(['My Folder'])
  })

  it('handles the acceptance-criteria style query', () => {
    const q = parseSearchQuery('tag:#project -draft "exact phrase" path:Work')
    expect(q).toMatchObject({
      tag: ['project'],
      excludes: ['draft'],
      phrases: ['exact phrase'],
      path: ['Work'],
      terms: []
    })
  })
})
