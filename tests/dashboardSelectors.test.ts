import { describe, expect, it } from 'vitest'
import type { BoardColumn, NoteMeta } from '@shared/types'
import { DEFAULT_VAULT_CONFIG } from '@shared/types'
import { parseNote } from '@shared/parser/parseNote'
import {
  findColumnByName,
  inProgressCards,
  isExternalLink,
  pinnedNoteEntries,
  upcomingDeadlines
} from '@/dashboard/dashboardSelectors'

/** Build a notes Map by parsing each [path, content] pair (mtime fixed for determinism). */
function vault(...files: Array<[string, string]>): Map<string, NoteMeta> {
  const notes = new Map<string, NoteMeta>()
  for (const [path, content] of files) notes.set(path, parseNote(path, content, 1_700_000_000_000))
  return notes
}

const columns: BoardColumn[] = DEFAULT_VAULT_CONFIG.columns

describe('dashboardSelectors', () => {
  describe('findColumnByName', () => {
    it('matches case-insensitively and trims', () => {
      expect(findColumnByName(columns, '  in progress  ')).toMatchObject({ char: '/' })
      expect(findColumnByName(columns, 'IN PROGRESS')).toMatchObject({ char: '/' })
    })

    it('returns null when no column has that name', () => {
      const renamed = columns.map((c) => (c.char === '/' ? { ...c, name: 'Doing' } : c))
      expect(findColumnByName(renamed, 'In Progress')).toBeNull()
    })
  })

  describe('inProgressCards', () => {
    it('returns only tasks in the In Progress column, excluding subtasks', () => {
      const notes = vault([
        'note.md',
        '- [/] Working on this\n  - [/] a subtask\n- [ ] Not started\n- [x] Done already\n'
      ])
      const cards = inProgressCards(notes, columns)
      expect(cards).toHaveLength(1)
      expect(cards[0].text).toBe('Working on this')
    })

    it('returns an empty array when no column is named "In Progress"', () => {
      const notes = vault(['note.md', '- [/] Working on this\n'])
      const renamed = columns.map((c) => (c.char === '/' ? { ...c, name: 'Doing' } : c))
      expect(inProgressCards(notes, renamed)).toEqual([])
    })
  })

  describe('pinnedNoteEntries', () => {
    it('preserves pin order and resolves titles', () => {
      const notes = vault(['b.md', '# B\n'], ['a.md', '# A\n'])
      const entries = pinnedNoteEntries(notes, ['b.md', 'a.md'])
      expect(entries.map((e) => e.path)).toEqual(['b.md', 'a.md'])
      expect(entries.every((e) => !e.missing)).toBe(true)
    })

    it('flags a pinned path no longer in the index as missing', () => {
      const notes = vault(['a.md', '# A\n'])
      const entries = pinnedNoteEntries(notes, ['a.md', 'deleted.md'])
      expect(entries[1]).toMatchObject({ path: 'deleted.md', missing: true })
    })
  })

  describe('upcomingDeadlines', () => {
    const today = '2026-07-12'

    it('puts an undone past-dated task in overdue', () => {
      const notes = vault(['note.md', '- [ ] Late task 📅 2026-07-01\n'])
      const { overdue } = upcomingDeadlines(notes, today)
      expect(overdue).toHaveLength(1)
      expect(overdue[0].text).toBe('Late task')
    })

    it('puts a task dated today in upcoming', () => {
      const notes = vault(['note.md', '- [ ] Due today 📅 2026-07-12\n'])
      const { overdue, upcoming } = upcomingDeadlines(notes, today)
      expect(overdue).toHaveLength(0)
      expect(upcoming.map((i) => i.text)).toContain('Due today')
    })

    it('excludes an archived task dated in the past from overdue (regression for e67c29e)', () => {
      const notes = vault(['note.md', '- [a] Archived old task 📅 2026-07-01\n'])
      const { overdue } = upcomingDeadlines(notes, today)
      expect(overdue).toHaveLength(0)
    })

    it('excludes items beyond the horizon from upcoming', () => {
      const notes = vault(['note.md', '- [ ] Far future 📅 2026-12-25\n'])
      const { upcoming } = upcomingDeadlines(notes, today, { horizonDays: 14 })
      expect(upcoming.map((i) => i.text)).not.toContain('Far future')
    })
  })

  describe('isExternalLink', () => {
    it('recognizes http and https URLs', () => {
      expect(isExternalLink('https://example.com')).toBe(true)
      expect(isExternalLink('http://example.com')).toBe(true)
      expect(isExternalLink('  https://example.com  ')).toBe(true)
    })

    it('treats note references as internal', () => {
      expect(isExternalLink('Projects/Foo.md')).toBe(false)
      expect(isExternalLink('Foo')).toBe(false)
      expect(isExternalLink('[[Foo]]')).toBe(false)
    })

    it('rejects non-http(s) schemes', () => {
      expect(isExternalLink('file:///etc/passwd')).toBe(false)
      expect(isExternalLink('javascript:alert(1)')).toBe(false)
    })
  })
})
