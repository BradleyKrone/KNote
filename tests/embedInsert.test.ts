import { describe, expect, it } from 'vitest'
import { wrapEmbedForInsertion } from '../src/shared/embedInsert'

describe('wrapEmbedForInsertion', () => {
  it('adds no newlines when the cursor is alone on an empty line', () => {
    expect(wrapEmbedForInsertion('', 0, '![[/a.png]]')).toBe('![[/a.png]]')
  })

  it('prepends a newline when there is text before the cursor', () => {
    expect(wrapEmbedForInsertion('# Heading', 9, '![[/a.png]]')).toBe('\n![[/a.png]]')
  })

  it('appends a newline when there is text after the cursor', () => {
    expect(wrapEmbedForInsertion('# Heading', 0, '![[/a.png]]')).toBe('![[/a.png]]\n')
  })

  it('wraps with newlines on both sides when pasting mid-line', () => {
    expect(wrapEmbedForInsertion('before after', 6, '![[/a.png]]')).toBe('\n![[/a.png]]\n')
  })
})
