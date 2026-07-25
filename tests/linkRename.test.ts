import { describe, expect, it } from 'vitest'
import type { NoteMeta } from '@shared/types'
import { parseNote } from '@shared/parser/parseNote'
import { planLinkRenames, renameLinksInContent } from '../src/core/linkRename'

/** Index map built the way the host builds it, so resolution matches production. */
function notesOf(...entries: Array<[string, string]>): Map<string, NoteMeta> {
  return new Map(entries.map(([path, content]) => [path, parseNote(path, content)]))
}

const vault = (): Map<string, NoteMeta> =>
  notesOf(['Target.md', ''], ['Projects/Target.md', ''], ['Other.md', ''])

describe('renameLinksInContent', () => {
  it('rewrites a bare-title link to the new title', () => {
    const notes = notesOf(['Target.md', ''])
    const result = renameLinksInContent('See [[Target]] here.\n', 'Target.md', 'Renamed.md', notes)
    expect(result).toBe('See [[Renamed]] here.\n')
  })

  it('leaves a bare link untouched when the note only moves folders', () => {
    // The title is unchanged, so [[Target]] still resolves — no rewrite at all.
    const notes = notesOf(['Target.md', ''])
    expect(
      renameLinksInContent('[[Target]]\n', 'Target.md', 'Archive/Sub/Target.md', notes)
    ).toBeNull()
  })

  it('returns null when no link resolves to the renamed note', () => {
    const notes = vault()
    expect(renameLinksInContent('[[Other]] only.\n', 'Target.md', 'New.md', notes)).toBeNull()
  })

  it('preserves #heading, #^block, |alias and the ! embed prefix', () => {
    const notes = notesOf(['Target.md', ''])
    const content = '[[Target#Intro]] [[Target#^abc123]] [[Target|call it this]] ![[Target]]\n'
    const result = renameLinksInContent(content, 'Target.md', 'New.md', notes)
    expect(result).toBe('[[New#Intro]] [[New#^abc123]] [[New|call it this]] ![[New]]\n')
  })

  it('rewrites a path-form link to the full new path, keeping .md only if it was written', () => {
    const notes = notesOf(['Projects/Target.md', ''])
    expect(
      renameLinksInContent('[[Projects/Target]]\n', 'Projects/Target.md', 'Archive/Done.md', notes)
    ).toBe('[[Archive/Done]]\n')
    expect(
      renameLinksInContent(
        '[[Projects/Target.md]]\n',
        'Projects/Target.md',
        'Archive/Done.md',
        notes
      )
    ).toBe('[[Archive/Done.md]]\n')
  })

  it('falls back to the full path when the new title would be ambiguous', () => {
    // A Renamed.md already exists at the root, so a bare [[Renamed]] would be
    // ambiguous once Target.md lands at Sub/Renamed.md — carry the path.
    const notes = notesOf(['Target.md', ''], ['Renamed.md', ''])
    expect(renameLinksInContent('[[Target]]\n', 'Target.md', 'Sub/Renamed.md', notes)).toBe(
      '[[Sub/Renamed]]\n'
    )
  })

  it('keeps the bare form when no other note claims the new title', () => {
    const notes = notesOf(['Target.md', ''], ['Unrelated.md', ''])
    expect(renameLinksInContent('[[Target]]\n', 'Target.md', 'Sub/Renamed.md', notes)).toBe(
      '[[Renamed]]\n'
    )
  })

  it('leaves alias-resolved links alone (the alias travels with the note)', () => {
    const notes = notesOf(['Target.md', '---\naliases: [Nickname]\n---\n'])
    expect(renameLinksInContent('[[Nickname]]\n', 'Target.md', 'New.md', notes)).toBeNull()
  })

  it('matches case-insensitively but writes the new casing', () => {
    const notes = notesOf(['Target.md', ''])
    expect(renameLinksInContent('[[target]]\n', 'Target.md', 'New.md', notes)).toBe('[[New]]\n')
  })

  it('does not touch links inside fenced code or inline code', () => {
    const notes = notesOf(['Target.md', ''])
    const content = 'Real [[Target]]\n\n```\n[[Target]] in code\n```\n\nAnd `[[Target]]` inline.\n'
    const result = renameLinksInContent(content, 'Target.md', 'New.md', notes)
    expect(result).toBe(
      'Real [[New]]\n\n```\n[[Target]] in code\n```\n\nAnd `[[Target]]` inline.\n'
    )
  })

  it('rewrites every occurrence in one pass', () => {
    const notes = notesOf(['Target.md', ''])
    const result = renameLinksInContent(
      '[[Target]] then [[Target|x]] then [[Target#H]]\n',
      'Target.md',
      'New.md',
      notes
    )
    expect(result).toBe('[[New]] then [[New|x]] then [[New#H]]\n')
  })

  it('does not rewrite a link that resolves to a different same-titled note', () => {
    const notes = notesOf(['Projects/Target.md', ''], ['Target.md', ''])
    // [[Projects/Target]] resolves by path to Projects/Target.md, so renaming
    // the root Target.md must leave it untouched.
    expect(renameLinksInContent('[[Projects/Target]]\n', 'Target.md', 'New.md', notes)).toBeNull()
  })
})

describe('planLinkRenames', () => {
  it('returns only the notes whose text changed', () => {
    const notes = notesOf(['Target.md', ''], ['A.md', '[[Target]]'], ['B.md', 'nothing'])
    const changed = planLinkRenames(
      [{ oldPath: 'Target.md', newPath: 'New.md' }],
      [
        ['A.md', '[[Target]]'],
        ['B.md', 'nothing']
      ],
      notes
    )
    expect([...changed.keys()]).toEqual(['A.md'])
    expect(changed.get('A.md')).toBe('[[New]]')
  })

  it('settles a folder rename where renamed notes link to each other', () => {
    const notes = notesOf(['Proj/One.md', '[[Proj/Two]]'], ['Proj/Two.md', '[[Proj/One]]'])
    const changed = planLinkRenames(
      [
        { oldPath: 'Proj/One.md', newPath: 'Archive/One.md' },
        { oldPath: 'Proj/Two.md', newPath: 'Archive/Two.md' }
      ],
      [
        ['Proj/One.md', '[[Proj/Two]]'],
        ['Proj/Two.md', '[[Proj/One]]']
      ],
      notes
    )
    expect(changed.get('Proj/One.md')).toBe('[[Archive/Two]]')
    expect(changed.get('Proj/Two.md')).toBe('[[Archive/One]]')
  })

  it('ignores a rename that only changes case', () => {
    const notes = notesOf(['Target.md', ''], ['A.md', '[[Target]]'])
    const changed = planLinkRenames(
      [{ oldPath: 'Target.md', newPath: 'target.md' }],
      [['A.md', '[[Target]]']],
      notes
    )
    expect(changed.size).toBe(0)
  })
})
