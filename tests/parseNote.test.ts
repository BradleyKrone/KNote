import { describe, expect, it } from 'vitest'
import { parseNote } from '@shared/parser/parseNote'

describe('parseNote', () => {
  it('extracts the title from the path', () => {
    const meta = parseNote('folder/My Note.md', '')
    expect(meta.title).toBe('My Note')
    expect(meta.path).toBe('folder/My Note.md')
  })

  it('parses frontmatter tags and aliases', () => {
    const meta = parseNote(
      'a.md',
      '---\ntags: [project, work/deep]\naliases:\n  - Alt Name\ncreated: 2026-07-01\n---\n\nBody.\n'
    )
    expect(meta.tags.map((t) => t.tag)).toEqual(['project', 'work/deep'])
    expect(meta.aliases).toEqual(['Alt Name'])
    expect(meta.frontmatter.created).toBeTruthy()
    expect(meta.frontmatterError).toBe(false)
  })

  it('tolerates malformed YAML without crashing', () => {
    const meta = parseNote('a.md', '---\n: : : bad [yaml\n---\n\nBody\n')
    expect(meta.frontmatterError).toBe(true)
    expect(meta.frontmatter).toEqual({})
  })

  it('extracts headings with levels and lines', () => {
    const meta = parseNote('a.md', '# One\n\ntext\n\n## Two\n')
    expect(meta.headings).toEqual([
      { text: 'One', level: 1, line: 0 },
      { text: 'Two', level: 2, line: 4 }
    ])
  })

  it('extracts wiki links with heading, alias, and embed forms', () => {
    const content = 'See [[Other Note]] and [[N#Head|shown]] plus ![[Pic.png]].\n'
    const meta = parseNote('a.md', content)
    expect(meta.links).toHaveLength(3)
    expect(meta.links[0]).toMatchObject({ target: 'Other Note', embed: false, line: 0 })
    expect(meta.links[1]).toMatchObject({ target: 'N', heading: 'Head', alias: 'shown' })
    expect(meta.links[2]).toMatchObject({ target: 'Pic.png', embed: true })
    expect(meta.links[0].context).toContain('[[Other Note]]')
  })

  it('ignores links and tags inside code blocks and inline code', () => {
    const content =
      'Real [[Link]] and #real\n\n```\n[[NotALink]] #nottag\n```\n\nAnd `[[inline#no]]` end.\n'
    const meta = parseNote('a.md', content)
    expect(meta.links.map((l) => l.target)).toEqual(['Link'])
    expect(meta.tags.map((t) => t.tag)).toEqual(['real'])
  })

  it('extracts body tags but not headings or pure numbers', () => {
    const meta = parseNote('a.md', '# Heading\n\n#tag1 word #nested/tag #123 not#this\n')
    expect(meta.tags.map((t) => t.tag)).toEqual(['tag1', 'nested/tag'])
  })

  it('extracts tasks with custom status chars and nesting', () => {
    const content = '- [ ] open\n- [x] done\n- [/] doing #urgent\n  - [ ] child\n1. [ ] numbered\n'
    const meta = parseNote('a.md', content)
    expect(meta.tasks).toHaveLength(5)
    expect(meta.tasks[0]).toMatchObject({ statusChar: ' ', text: 'open', line: 0, indent: 0 })
    expect(meta.tasks[1]).toMatchObject({ statusChar: 'x', text: 'done' })
    expect(meta.tasks[2]).toMatchObject({ statusChar: '/', tags: ['urgent'] })
    expect(meta.tasks[3]).toMatchObject({ indent: 2, text: 'child' })
    expect(meta.tasks[4]).toMatchObject({ text: 'numbered' })
    expect(meta.tasks[2].rawLine).toBe('- [/] doing #urgent')
  })

  it('preserves rawLine for CRLF content without the \\r', () => {
    const meta = parseNote('a.md', '- [ ] one\r\n- [x] two\r\n')
    expect(meta.tasks[0].rawLine).toBe('- [ ] one')
    expect(meta.tasks[1].rawLine).toBe('- [x] two')
    expect(meta.tasks[1].line).toBe(1)
  })

  it('does not treat checkbox-looking lines inside fences as tasks', () => {
    const meta = parseNote('a.md', '```\n- [ ] fake\n```\n\n- [ ] real\n')
    expect(meta.tasks).toHaveLength(1)
    expect(meta.tasks[0].text).toBe('real')
  })

  it('handles unicode task text', () => {
    const meta = parseNote('a.md', '- [ ] émojis 🎉 und Ümlaute\n')
    expect(meta.tasks[0].text).toBe('émojis 🎉 und Ümlaute')
  })
})
