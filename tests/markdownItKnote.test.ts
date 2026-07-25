// The Reading-mode markdown-it plugin. It reads the live vault index to
// resolve targets, so the index module is stubbed with a fixed set of notes.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import MarkdownIt from 'markdown-it'
import { parseNote } from '@shared/parser/parseNote'
import type { NoteMeta } from '@shared/types'

const snapshot: NoteMeta[] = []

vi.mock('../src/core/indexer/vaultIndex', () => ({
  getSnapshot: () => snapshot
}))

const { extendMarkdownIt } = await import('../src/extension/markdownItKnote')

function setVault(...paths: string[]): void {
  snapshot.length = 0
  for (const path of paths) snapshot.push(parseNote(path, ''))
}

function render(source: string): string {
  return extendMarkdownIt(new MarkdownIt()).render(source)
}

describe('extendMarkdownIt (Reading mode)', () => {
  beforeEach(() => {
    setVault('Target.md', 'Projects/Deep Note.md', 'Sample.md')
  })

  it('links a resolved wiki target to its workspace-relative path', () => {
    const html = render('See [[Target]].\n')
    expect(html).toContain('href="/Target.md"')
    expect(html).toContain('class="knote-wikilink"')
    expect(html).toContain('>Target</a>')
  })

  it('resolves a note in a subfolder by title', () => {
    expect(render('[[Deep Note]]\n')).toContain('href="/Projects/Deep Note.md"')
  })

  it('renders an unresolved target as inert text, not a link', () => {
    const html = render('[[No Such Note]]\n')
    expect(html).toContain('knote-unresolved')
    expect(html).not.toContain('<a ')
    expect(html).toContain('No Such Note')
  })

  it('turns a #Heading into a slug fragment', () => {
    expect(render('[[Target#Some Heading Here]]\n')).toContain(
      'href="/Target.md#some-heading-here"'
    )
  })

  it('drops a #^block fragment (rendered HTML has no such anchor) but keeps the note link', () => {
    expect(render('[[Target#^abc123]]\n')).toContain('href="/Target.md"')
  })

  it('uses the |display text', () => {
    const html = render('[[Target|see this]]\n')
    expect(html).toContain('>see this</a>')
    expect(html).toContain('title="Target"')
  })

  it('renders a vault-root-relative image embed (the form paste-image writes)', () => {
    const html = render('![[/Knote Resources/Attachments/shot.png]]\n')
    expect(html).toContain('<img')
    expect(html).toContain('src="/Knote Resources/Attachments/shot.png"')
  })

  it('renders a note embed as a link rather than an image', () => {
    const html = render('![[Target]]\n')
    expect(html).toContain('href="/Target.md"')
    expect(html).not.toContain('<img')
  })

  it('renders #tags as pills and leaves numeric ones alone', () => {
    const html = render('Body #urgent and issue #42.\n')
    expect(html).toContain('<span class="knote-tag">#urgent</span>')
    expect(html).toContain('#42')
    expect(html.match(/knote-tag/g)?.length).toBe(1)
  })

  it('leaves wiki links and tags inside code untouched', () => {
    const html = render('`[[Target]]`\n\n```\n[[Target]] #tag\n```\n')
    expect(html).not.toContain('knote-wikilink')
    expect(html).not.toContain('knote-tag')
  })

  it('still renders ordinary markdown, including standard images and links', () => {
    const html = render('# H\n\n[text](https://example.com) and ![alt](pic.png)\n')
    expect(html).toContain('<h1>H</h1>')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('src="pic.png"')
  })
})
