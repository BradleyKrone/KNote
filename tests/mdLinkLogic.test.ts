import { describe, expect, it } from 'vitest'
import { isExternalUrl } from '../src/shared/externalUrl'
import { buildMdLink, mdLinkAt } from '../src/webviews/editor/mdLinkLogic'

describe('mdLinkAt', () => {
  const line = 'See [the docs](https://example.com/a) and [other](https://b.test) here'

  it('finds the link the offset sits inside', () => {
    expect(mdLinkAt(line, 0, 8)?.url).toBe('https://example.com/a')
    expect(mdLinkAt(line, 0, 45)?.url).toBe('https://b.test')
  })

  it('returns the display text and the whole span', () => {
    const hit = mdLinkAt(line, 0, 4)
    expect(hit?.text).toBe('the docs')
    expect(hit?.from).toBe(4)
    expect(hit?.to).toBe(37)
    expect(line.slice(hit!.from, hit!.to)).toBe('[the docs](https://example.com/a)')
  })

  it('returns null between links and past the end', () => {
    expect(mdLinkAt(line, 0, 38)).toBeNull()
    expect(mdLinkAt(line, 0, line.length)).toBeNull()
  })

  it('offsets by the line start', () => {
    const hit = mdLinkAt('[a](https://x.test)', 100, 103)
    expect(hit?.from).toBe(100)
    expect(hit?.to).toBe(119)
  })

  it('skips images — those render inline, they are not hyperlinks', () => {
    expect(mdLinkAt('![alt](img.png)', 0, 3)).toBeNull()
  })

  it('finds a real link sitting next to an image', () => {
    const mixed = '![alt](img.png) then [text](https://x.test)'
    expect(mdLinkAt(mixed, 0, 3)).toBeNull()
    expect(mdLinkAt(mixed, 0, 25)?.url).toBe('https://x.test')
  })

  it('tolerates nested brackets in the link text', () => {
    const hit = mdLinkAt('[see [1] here](https://x.test)', 0, 3)
    expect(hit?.text).toBe('see [1] here')
    expect(hit?.url).toBe('https://x.test')
  })

  it('handles balanced parens inside the URL', () => {
    const hit = mdLinkAt('[wp](https://en.wikipedia.org/wiki/Foo_(bar))', 0, 2)
    expect(hit?.url).toBe('https://en.wikipedia.org/wiki/Foo_(bar)')
  })

  it('strips angle brackets and drops a title', () => {
    expect(mdLinkAt('[a](<https://x.test/a b>)', 0, 2)?.url).toBe('https://x.test/a b')
    expect(mdLinkAt('[a](https://x.test "Title")', 0, 2)?.url).toBe('https://x.test')
  })
})

describe('buildMdLink', () => {
  it('builds a link', () => {
    expect(buildMdLink('docs', 'https://x.test')).toBe('[docs](https://x.test)')
  })

  it('falls back to the URL when the text is blank, so nothing is invisible', () => {
    expect(buildMdLink('', 'https://x.test')).toBe('[https://x.test](https://x.test)')
    expect(buildMdLink('   ', 'https://x.test')).toBe('[https://x.test](https://x.test)')
  })

  it('trims the display text', () => {
    expect(buildMdLink('  docs  ', 'https://x.test')).toBe('[docs](https://x.test)')
  })
})

describe('isExternalUrl', () => {
  it('accepts http, https and mailto', () => {
    expect(isExternalUrl('https://x.test')).toBe(true)
    expect(isExternalUrl('http://x.test')).toBe(true)
    expect(isExternalUrl('mailto:a@b.test')).toBe(true)
  })

  it('rejects schemes that must never reach openExternal', () => {
    expect(isExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isExternalUrl('vscode://x')).toBe(false)
  })

  it('rejects relative targets and junk', () => {
    expect(isExternalUrl('./other-note.md')).toBe(false)
    expect(isExternalUrl('')).toBe(false)
  })
})
