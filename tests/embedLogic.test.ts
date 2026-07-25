import { describe, expect, it } from 'vitest'
import { isNoteEmbedLine, noteEmbedLine } from '../src/webviews/editor/embedLogic'

describe('noteEmbedLine', () => {
  it('recognizes a note embed that owns its line', () => {
    expect(noteEmbedLine('![[Some Note]]')).toBe('Some Note')
    expect(noteEmbedLine('   ![[Some Note]]  ')).toBe('Some Note')
  })

  it('keeps the #section on the target', () => {
    expect(noteEmbedLine('![[Note#Heading]]')).toBe('Note#Heading')
    expect(noteEmbedLine('![[Note#^abc123]]')).toBe('Note#^abc123')
  })

  it('ignores image embeds (knoteConstructs renders those inline)', () => {
    expect(noteEmbedLine('![[shot.png]]')).toBeNull()
    expect(noteEmbedLine('![[sub/diagram.SVG]]')).toBeNull()
  })

  it('ignores an embed sharing its line with other text', () => {
    expect(noteEmbedLine('See ![[Some Note]] there')).toBeNull()
    expect(noteEmbedLine('![[Some Note]] trailing')).toBeNull()
  })

  it('ignores a plain (non-embed) wiki link', () => {
    expect(noteEmbedLine('[[Some Note]]')).toBeNull()
  })

  it('ignores lines with no wiki link at all', () => {
    expect(noteEmbedLine('')).toBeNull()
    expect(noteEmbedLine('- [ ] a task')).toBeNull()
    expect(noteEmbedLine('![](image.png)')).toBeNull()
  })

  it('exposes the same rule as a boolean for knoteConstructs', () => {
    expect(isNoteEmbedLine('![[Note]]')).toBe(true)
    expect(isNoteEmbedLine('![[Note]] and text')).toBe(false)
  })
})
