import { describe, expect, it } from 'vitest'
import type { NoteMeta } from '@shared/types'
import { parseNote } from '@shared/parser/parseNote'
import { collectWeeklyNotes, weekOf } from '@ext/trees/weeklySelectors'

const FORMAT = 'YYYY-M-D'

/** Build notes from [path, mtimeMs] pairs — content is irrelevant to ordering. */
function vault(...files: Array<[string, number]>): NoteMeta[] {
  return files.map(([path, mtimeMs]) => parseNote(path, '', mtimeMs))
}

const paths = (notes: NoteMeta[], current = 'Weekly/2026-8-3.md'): string[] =>
  collectWeeklyNotes(notes, { folder: 'Weekly', format: FORMAT, current }).map((n) => n.path)

describe('weekOf', () => {
  it('reads the week from an unpadded file name', () => {
    expect(weekOf('Weekly/2026-7-6.md', FORMAT)).toBe(new Date(2026, 6, 6).getTime())
  })

  it('tolerates a duplicate-copy suffix', () => {
    expect(weekOf('Weekly/2026-7-13 1.md', FORMAT)).toBe(weekOf('Weekly/2026-7-13.md', FORMAT))
  })

  it('returns null for a name that is not a date', () => {
    expect(weekOf('Weekly/Ideas.md', FORMAT)).toBeNull()
  })
})

describe('collectWeeklyNotes', () => {
  it('orders by the date in the name, newest first, ignoring mtime', () => {
    // mtimes deliberately scrambled: the oldest week was edited most recently.
    const notes = vault(
      ['Weekly/2026-7-6.md', 9_000],
      ['Weekly/2026-7-27.md', 1_000],
      ['Weekly/2026-7-13.md', 5_000],
      ['Weekly/2026-7-20.md', 2_000]
    )
    expect(paths(notes)).toEqual([
      'Weekly/2026-7-27.md',
      'Weekly/2026-7-20.md',
      'Weekly/2026-7-13.md',
      'Weekly/2026-7-6.md'
    ])
  })

  it('keeps a duplicate copy beside its own week', () => {
    const notes = vault(
      ['Weekly/2026-7-13 1.md', 1_000],
      ['Weekly/2026-7-20.md', 2_000],
      ['Weekly/2026-7-13.md', 3_000]
    )
    expect(paths(notes)).toEqual([
      'Weekly/2026-7-20.md',
      'Weekly/2026-7-13.md',
      'Weekly/2026-7-13 1.md'
    ])
  })

  it('parks undated names at the end, newest-touched first', () => {
    const notes = vault(
      ['Weekly/Ideas.md', 1_000],
      ['Weekly/2026-7-6.md', 500],
      ['Weekly/Scratch.md', 8_000]
    )
    expect(paths(notes)).toEqual(['Weekly/2026-7-6.md', 'Weekly/Scratch.md', 'Weekly/Ideas.md'])
  })

  it('excludes this week and anything outside the weekly folder', () => {
    const notes = vault(
      ['Weekly/2026-8-3.md', 1_000],
      ['Weekly/2026-7-27.md', 1_000],
      ['Notes/2026-7-20.md', 1_000]
    )
    expect(paths(notes)).toEqual(['Weekly/2026-7-27.md'])
  })

  it('handles a padded weekly format too', () => {
    const notes = vault(['Weekly/2026-07-06.md', 1_000], ['Weekly/2026-07-27.md', 1_000])
    const out = collectWeeklyNotes(notes, {
      folder: 'Weekly',
      format: 'YYYY-MM-DD',
      current: 'Weekly/2026-08-03.md'
    })
    expect(out.map((n) => n.path)).toEqual(['Weekly/2026-07-27.md', 'Weekly/2026-07-06.md'])
  })
})
