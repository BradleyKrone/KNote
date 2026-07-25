import { describe, expect, it } from 'vitest'
import { truncateLines, wikiLinkAt } from '../src/webviews/editor/hoverLogic'

describe('wikiLinkAt', () => {
  const line = 'Start [[Target]] middle [[Other#Heading]] end'

  it('finds the link the offset sits inside', () => {
    expect(wikiLinkAt(line, 0, 8)?.rawTarget).toBe('Target')
    expect(wikiLinkAt(line, 0, 30)?.rawTarget).toBe('Other#Heading')
  })

  it('includes the brackets themselves', () => {
    const hit = wikiLinkAt(line, 0, 6)
    expect(hit?.rawTarget).toBe('Target')
    expect(hit?.from).toBe(6)
    expect(hit?.to).toBe(16)
  })

  it('returns null between links and past the end', () => {
    expect(wikiLinkAt(line, 0, 20)).toBeNull()
    expect(wikiLinkAt(line, 0, line.length)).toBeNull()
  })

  it('offsets by the line start', () => {
    const hit = wikiLinkAt('[[Target]]', 100, 103)
    expect(hit?.from).toBe(100)
    expect(hit?.to).toBe(110)
  })

  it('skips embeds — they already display their content', () => {
    expect(wikiLinkAt('![[Target]]', 0, 5)).toBeNull()
  })

  it('handles an aliased link, previewing the target not the alias', () => {
    expect(wikiLinkAt('[[Target|shown text]]', 0, 4)?.rawTarget).toBe('Target')
  })

  it('returns null on a line with no links', () => {
    expect(wikiLinkAt('- [ ] a plain task', 0, 5)).toBeNull()
  })
})

describe('truncateLines', () => {
  it('leaves short content alone', () => {
    expect(truncateLines('a\nb\nc', 5)).toEqual({ text: 'a\nb\nc', truncated: false })
  })

  it('cuts at the limit and flags it', () => {
    expect(truncateLines('a\nb\nc\nd', 2)).toEqual({ text: 'a\nb', truncated: true })
  })

  it('treats exactly-at-the-limit as untruncated', () => {
    expect(truncateLines('a\nb', 2)).toEqual({ text: 'a\nb', truncated: false })
  })
})
