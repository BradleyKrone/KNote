import { describe, expect, it } from 'vitest'
import { renderKnoteMarkdown } from '@shared/renderMarkdown'

const opts = {
  wikiHref: (target: string) => (target.startsWith('Missing') ? null : `/vault/${target}`),
  imageSrc: (target: string) => (target === 'gone.png' ? null : `vscode-webview://img/${target}`)
}

describe('renderKnoteMarkdown', () => {
  it('renders ordinary markdown', () => {
    expect(renderKnoteMarkdown('# Title\n\nSome **bold** text.\n')).toBe(
      '<h1>Title</h1>\n<p>Some <strong>bold</strong> text.</p>\n'
    )
  })

  it('renders a wiki link as an anchor with the resolved href', () => {
    const html = renderKnoteMarkdown('See [[Other Note]].\n', opts)
    expect(html).toContain('href="/vault/Other Note"')
    expect(html).toContain('class="knote-wikilink"')
    expect(html).toContain('>Other Note</a>')
  })

  it('renders an unresolved wiki link as inert text', () => {
    const html = renderKnoteMarkdown('See [[Missing One]].\n', opts)
    expect(html).toContain('knote-unresolved')
    expect(html).not.toContain('<a ')
  })

  it('uses the display text of an aliased link and keeps the target in the title', () => {
    const html = renderKnoteMarkdown('[[Other|call it this]]\n', opts)
    expect(html).toContain('>call it this</a>')
    expect(html).toContain('title="Other"')
  })

  it('keeps the #section in the href', () => {
    const html = renderKnoteMarkdown('[[Other#Heading]]\n', opts)
    expect(html).toContain('href="/vault/Other#Heading"')
  })

  it('carries the raw target in data-knote-target, independent of the href', () => {
    // The embed card resolves the target itself (openWikiTarget) while the href
    // is whatever the rendering host wants — VS Code's preview rewrites it, the
    // card sets a placeholder. So the target must not have to be recovered from
    // the href, spaces and all.
    const html = renderKnoteMarkdown('[[Other Note#Some Heading]]\n', opts)
    expect(html).toContain('data-knote-target="Other Note#Some Heading"')
  })

  it('renders an image embed as an img token (so a host can rewrite the src)', () => {
    const html = renderKnoteMarkdown('![[shot.png]]\n', opts)
    expect(html).toContain('<img')
    expect(html).toContain('src="vscode-webview://img/shot.png"')
    expect(html).toContain('class="knote-embed-image"')
    expect(html).toContain('alt="shot.png"')
  })

  it('marks an unresolved image embed instead of emitting a broken img', () => {
    const html = renderKnoteMarkdown('![[gone.png]]\n', opts)
    expect(html).toContain('knote-embed-missing')
    expect(html).not.toContain('<img')
  })

  it('renders a note embed as a link rather than recursing', () => {
    const html = renderKnoteMarkdown('![[Other Note]]\n', opts)
    expect(html).toContain('class="knote-wikilink"')
    expect(html).not.toContain('<img')
  })

  it('renders #tags as pills', () => {
    const html = renderKnoteMarkdown('Body #urgent and #work/deep here.\n', opts)
    expect(html).toContain('<span class="knote-tag">#urgent</span>')
    expect(html).toContain('<span class="knote-tag">#work/deep</span>')
  })

  it('leaves a numeric-only #123 alone', () => {
    const html = renderKnoteMarkdown('Issue #123 here.\n')
    expect(html).not.toContain('knote-tag')
    expect(html).toContain('#123')
  })

  it('does not touch wiki links or tags inside code', () => {
    const html = renderKnoteMarkdown('`[[Other]]` and `#tag`\n\n```\n[[Other]] #tag\n```\n', opts)
    expect(html).not.toContain('knote-wikilink')
    expect(html).not.toContain('knote-tag')
    expect(html).toContain('[[Other]]')
  })

  it('escapes raw HTML in note source instead of injecting it', () => {
    const html = renderKnoteMarkdown('<img src=x onerror=alert(1)>\n')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })

  it('escapes HTML inside a link display text', () => {
    const html = renderKnoteMarkdown('[[Other|<b>x</b>]]\n', opts)
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;b&gt;')
  })

  it('renders tasks and nested lists as ordinary markdown', () => {
    const html = renderKnoteMarkdown('- [ ] a task\n  - detail\n')
    expect(html).toContain('<ul>')
    expect(html).toContain('a task')
  })
})
