import { describe, expect, it } from 'vitest'
import { blockIdOf, blockLink, generateBlockId } from '@/editor/taskLinkLogic'

describe('blockIdOf', () => {
  it('reads an existing trailing ^block-id', () => {
    expect(blockIdOf('- [ ] Ship the thing ^a1b2c3')).toBe('a1b2c3')
  })
  it('reads an id after a due date', () => {
    expect(blockIdOf('- [/] Do it 📅 2026-07-17 ^xyz789')).toBe('xyz789')
  })
  it('returns null when there is no anchor', () => {
    expect(blockIdOf('- [ ] Ship the thing')).toBeNull()
  })
  it('ignores a ^ that is not at end of line', () => {
    expect(blockIdOf('- [ ] a^b in the middle')).toBeNull()
  })
})

describe('blockLink', () => {
  it('builds a [[Title#^id]] wiki link', () => {
    expect(blockLink('2026-07-17', 'a1b2c3')).toBe('[[2026-07-17#^a1b2c3]]')
  })
})

describe('generateBlockId', () => {
  it('is a short url-safe id matching the block-anchor grammar', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateBlockId()
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(id.length).toBeGreaterThan(0)
      // Round-trips through blockIdOf when appended to a line.
      expect(blockIdOf(`- [ ] task ^${id}`)).toBe(id)
    }
  })
})
