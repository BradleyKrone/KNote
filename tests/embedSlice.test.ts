import { describe, expect, it } from 'vitest'
import { parseNote } from '@shared/parser/parseNote'
import { sliceEmbedSection, stripFrontmatter } from '@shared/embedSlice'

const NOTE = [
  '---',
  'title: Doc',
  '---',
  '',
  '# Top',
  '',
  'intro prose',
  '',
  '## Alpha',
  '',
  'alpha body',
  '',
  '### Alpha Deep',
  '',
  'deep body',
  '',
  '## Beta',
  '',
  'beta body',
  ''
].join('\n')

/** Slice `section` out of `content`, parsing its metadata the way the host does. */
function slice(content: string, section: string | null): string | null {
  return sliceEmbedSection(content, parseNote('Doc.md', content), section)
}

describe('stripFrontmatter', () => {
  it('removes a leading YAML block', () => {
    expect(stripFrontmatter('---\na: 1\n---\nBody\n')).toBe('Body\n')
  })

  it('leaves content without frontmatter untouched', () => {
    expect(stripFrontmatter('# Title\n\n---\n\nA rule.\n')).toBe('# Title\n\n---\n\nA rule.\n')
  })
})

describe('sliceEmbedSection', () => {
  it('returns the whole note without frontmatter for a plain embed', () => {
    const result = slice(NOTE, null)
    expect(result).not.toContain('title: Doc')
    expect(result).toContain('# Top')
    expect(result).toContain('beta body')
    expect(result?.endsWith('beta body')).toBe(true) // trailing blanks trimmed
  })

  it('slices a heading section down to the next same-level heading', () => {
    const result = slice(NOTE, 'Alpha')
    expect(result).toContain('## Alpha')
    expect(result).toContain('alpha body')
    // A deeper subsection belongs to the section...
    expect(result).toContain('### Alpha Deep')
    expect(result).toContain('deep body')
    // ...but the next same-level heading does not.
    expect(result).not.toContain('## Beta')
  })

  it('slices a deeper heading section', () => {
    const result = slice(NOTE, 'Alpha Deep')
    expect(result).toBe('### Alpha Deep\n\ndeep body')
  })

  it('slices the last heading section to the end of the note', () => {
    expect(slice(NOTE, 'Beta')).toBe('## Beta\n\nbeta body')
  })

  it('includes every subsection when embedding the top heading', () => {
    const result = slice(NOTE, 'Top')
    expect(result).toContain('## Alpha')
    expect(result).toContain('## Beta')
  })

  it('matches a heading case-insensitively', () => {
    expect(slice(NOTE, 'alpha deep')).toBe('### Alpha Deep\n\ndeep body')
  })

  it('returns null for a heading the note does not have', () => {
    expect(slice(NOTE, 'Nope')).toBeNull()
  })

  it('slices a block-anchored task together with its indented detail', () => {
    const content = [
      '- [ ] first task ^abc123',
      '  - Status Changed: n/a',
      '  - Notes: some detail',
      '- [ ] second task',
      '  - Notes: other'
    ].join('\n')
    const result = slice(content, '^abc123')
    expect(result).toBe('- [ ] first task ^abc123\n  - Status Changed: n/a\n  - Notes: some detail')
    expect(result).not.toContain('second task')
  })

  it('slices a block-anchored plain line on its own', () => {
    const content = 'Some paragraph ^para1\n\nAnother paragraph.\n'
    expect(slice(content, '^para1')).toBe('Some paragraph ^para1')
  })

  it('matches a block id case-insensitively and returns null for a missing one', () => {
    const content = '- [ ] task ^AbC123\n'
    expect(slice(content, '^abc123')).toBe('- [ ] task ^AbC123')
    expect(slice(content, '^nope')).toBeNull()
  })
})
