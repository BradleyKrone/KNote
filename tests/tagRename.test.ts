import { describe, expect, it } from 'vitest'
import { renameTagInContent } from '../src/main/tagRename'

describe('renameTagInContent', () => {
  it('renames a body tag, case-insensitively matched', () => {
    const content = 'Some text #knote here.\n'
    const result = renameTagInContent(content, 'knote', 'KNOTE')
    expect(result).toBe('Some text #KNOTE here.\n')
  })

  it('merges a differently-cased tag into the target casing', () => {
    const content = 'First #knote and second #KNOTE.\n'
    const result = renameTagInContent(content, 'knote', 'KNOTE')
    expect(result).toBe('First #KNOTE and second #KNOTE.\n')
  })

  it('returns null when the tag does not occur', () => {
    const content = 'No matching tag here #other.\n'
    expect(renameTagInContent(content, 'knote', 'KNOTE')).toBeNull()
  })

  it('does not touch tags inside fenced code blocks', () => {
    const content = 'Body #knote\n\n```\n#knote in code\n```\n'
    const result = renameTagInContent(content, 'knote', 'work')
    expect(result).toBe('Body #work\n\n```\n#knote in code\n```\n')
  })

  it('does not cascade to hierarchical children', () => {
    const content = '#knote and #knote/sub both here.\n'
    const result = renameTagInContent(content, 'knote', 'work')
    expect(result).toBe('#work and #knote/sub both here.\n')
  })

  it('renames a tag inside a frontmatter array', () => {
    const content = '---\ntags: [knote, work]\n---\n\nBody #knote.\n'
    const result = renameTagInContent(content, 'knote', 'KNOTE')
    expect(result).toContain('#KNOTE')
    expect(result).toMatch(/tags:\s*\n?\s*-?\s*KNOTE|tags:\s*\[KNOTE, work\]/)
    expect(result).not.toContain('knote')
  })

  it('renames a tag inside a frontmatter comma-separated string', () => {
    const content = '---\ntags: knote, work\n---\n\nBody.\n'
    const result = renameTagInContent(content, 'knote', 'KNOTE')
    expect(result).toContain('KNOTE')
    expect(result).not.toContain('knote,')
  })
})
