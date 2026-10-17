import { describe, expect, it } from 'vitest'
import type { NoteMeta } from '@shared/types'
import { parseNote } from '@shared/parser/parseNote'
import {
  collectWeeklyNotes,
  folderedFormat,
  groupWeeklyNotes,
  plannedWeeklyMoves,
  weekOf
} from '@ext/trees/weeklySelectors'

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

const NESTED = 'YYYY/MM MMMM/YYYY-M-D'

describe('foldered weekly format', () => {
  it('reads the week from the file name alone', () => {
    expect(weekOf('Weekly/2026/10 October/2026-10-12.md', NESTED)).toBe(
      new Date(2026, 9, 12).getTime()
    )
    expect(weekOf('Weekly/2026/08 August/2026-8-17 2.md', NESTED)).toBe(
      new Date(2026, 7, 17).getTime()
    )
  })

  it('orders notes across folders by week, duplicates after their original', () => {
    const notes = vault(
      ['Weekly/2026/08 August/2026-8-17 1.md', 1_000],
      ['Weekly/2026/09 September/2026-9-28.md', 1_000],
      ['Weekly/2026/08 August/2026-8-17.md', 1_000],
      ['Weekly/2025/12 December/2025-12-29.md', 1_000]
    )
    const out = collectWeeklyNotes(notes, { folder: 'Weekly', format: NESTED, current: 'x.md' })
    expect(out.map((n) => n.path)).toEqual([
      'Weekly/2026/09 September/2026-9-28.md',
      'Weekly/2026/08 August/2026-8-17.md',
      'Weekly/2026/08 August/2026-8-17 1.md',
      'Weekly/2025/12 December/2025-12-29.md'
    ])
  })
})

describe('folderedFormat', () => {
  it('adds year / month folders to a flat format, keeping the file naming', () => {
    expect(folderedFormat('YYYY-M-D')).toBe('YYYY/MM MMMM/YYYY-M-D')
    expect(folderedFormat('YYYY-MM-DD')).toBe('YYYY/MM MMMM/YYYY-MM-DD')
  })

  it('leaves a format that already makes folders alone', () => {
    expect(folderedFormat('YYYY/YYYY-M-D')).toBe('YYYY/YYYY-M-D')
  })
})

describe('groupWeeklyNotes', () => {
  it('groups newest-first notes into years and months, keeping order', () => {
    const notes = vault(
      ['Weekly/2026-10-12.md', 1],
      ['Weekly/2026-10-5.md', 1],
      ['Weekly/2026-9-28.md', 1],
      ['Weekly/2025-12-29.md', 1],
      ['Weekly/Ideas.md', 1]
    )
    const { years, undated } = groupWeeklyNotes(
      collectWeeklyNotes(notes, { folder: 'Weekly', format: FORMAT, current: 'x.md' })
    )
    expect(
      years.map((y) => [y.year, y.months.map((m) => [m.label, m.notes.map((n) => n.title)])])
    ).toEqual([
      [
        2026,
        [
          ['October', ['2026-10-12', '2026-10-5']],
          ['September', ['2026-9-28']]
        ]
      ],
      [2025, [['December', ['2025-12-29']]]]
    ])
    expect(undated.map((n) => n.path)).toEqual(['Weekly/Ideas.md'])
  })
})

describe('plannedWeeklyMoves', () => {
  const plan = (...paths: string[]) =>
    plannedWeeklyMoves(
      paths.map((p) => parseNote(p, '', 0)),
      { folder: 'Weekly', format: NESTED }
    )

  it('files flat notes under their Monday’s year and month, names unchanged', () => {
    expect(plan('Weekly/2026-10-12.md', 'Weekly/2026-8-3 2.md').moves).toEqual([
      { from: 'Weekly/2026-10-12.md', to: 'Weekly/2026/10 October/2026-10-12.md' },
      { from: 'Weekly/2026-8-3 2.md', to: 'Weekly/2026/08 August/2026-8-3 2.md' }
    ])
  })

  it('files a week that crosses into the next month under its Monday', () => {
    // Monday 9/28 — the week runs into October but is named after September.
    expect(plan('Weekly/2026-9-28.md').moves[0].to).toBe('Weekly/2026/09 September/2026-9-28.md')
  })

  it('skips notes already in place, undated names and notes outside the folder', () => {
    const { moves, blocked } = plan(
      'Weekly/2026/10 October/2026-10-12.md',
      'Weekly/Ideas.md',
      'Notes/2026-10-5.md'
    )
    expect(moves).toEqual([])
    expect(blocked).toEqual([])
  })

  it('reports a move whose destination is taken instead of renaming it', () => {
    const { moves, blocked } = plan('Weekly/2026/10 October/2026-10-12.md', 'Weekly/2026-10-12.md')
    expect(moves).toEqual([])
    expect(blocked).toEqual(['Weekly/2026-10-12.md'])
  })
})
