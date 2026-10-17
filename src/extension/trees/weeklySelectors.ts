// Pure ordering for the "This Week" tree. No `vscode` import, so vitest can
// exercise the date parsing and ordering directly — weeklyTree.ts only turns
// these into TreeItems.

import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import type { NoteMeta, VaultPath } from '@shared/types'
import { isInside, joinRel, nameOf, parentOf, samePath } from '@shared/pathUtils'
import { weeklyFileFormat } from '@shared/previousDay'

dayjs.extend(customParseFormat)

export interface WeeklyNoteNode {
  path: VaultPath
  title: string
  /** The week's Monday (epoch ms) read from the file name, or null when undated. */
  week: number | null
}

/** "Weekly/2026-7-6 1.md" → "2026-7-6 1" */
function baseName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1)
  return file.replace(/\.md$/i, '')
}

/**
 * The week a note belongs to, read from its file name via the vault's
 * `weeklyFormat` — only the format's file-name part, since the folders a
 * `YYYY/MM MMMM/…` format adds aren't in the base name. A trailing " 1" (the
 * duplicate-name suffix) is tolerated, so a second copy of a week still files
 * under that week. Returns null when the name isn't a date at all.
 */
export function weekOf(path: string, format: string): number | null {
  const name = baseName(path)
  const fileFormat = weeklyFileFormat(format)
  for (const candidate of [name, name.replace(/\s+\d+$/, '')]) {
    const d = dayjs(candidate, fileFormat, true)
    if (d.isValid()) return d.valueOf()
  }
  return null
}

/**
 * Past weekly notes, newest week first.
 *
 * Ordered by the date *in the file name*, not by mtime: editing an old weekly
 * note shouldn't shuffle it to the top of the list, and sync clients rewrite
 * mtimes wholesale anyway. Plain string ordering won't do either — the default
 * `YYYY-M-D` format is unpadded, so "2026-7-6" sorts after "2026-7-27".
 */
export function collectWeeklyNotes(
  notes: Iterable<NoteMeta>,
  opts: { folder: string; format: string; current: VaultPath }
): WeeklyNoteNode[] {
  const prefix = opts.folder ? opts.folder + '/' : ''
  return [...notes]
    .filter((m) => m.path.startsWith(prefix) && m.path !== opts.current)
    .map((meta) => ({ meta, week: weekOf(meta.path, opts.format) }))
    .sort((a, b) => {
      // Undated names have no place in the chronology; park them at the end,
      // where most-recently-touched-first is as good an order as any.
      if (a.week === null || b.week === null) {
        if (a.week !== b.week) return a.week === null ? 1 : -1
        return b.meta.mtimeMs - a.meta.mtimeMs
      }
      // Same week (a duplicate copy) — keep it beside its original, and after
      // it: the copy carries the extra " 1", so it's the longer name.
      return (
        b.week - a.week ||
        nameOf(a.meta.path).length - nameOf(b.meta.path).length ||
        a.meta.path.localeCompare(b.meta.path)
      )
    })
    .map(({ meta, week }) => ({ path: meta.path, title: meta.title, week }))
}

export interface WeeklyMonthGroup {
  /** "2026-10" — stable id for the tree. */
  key: string
  /** "October" */
  label: string
  notes: WeeklyNoteNode[]
}

export interface WeeklyYearGroup {
  year: number
  months: WeeklyMonthGroup[]
}

/**
 * Split `collectWeeklyNotes`' newest-first list into Year → Month groups (by
 * the week's Monday, the same date the note is named and filed under), so the
 * sidebar stays short however many years of notes pile up. Order is preserved,
 * so years and months come out newest first. Undated notes are returned apart.
 */
export function groupWeeklyNotes(nodes: readonly WeeklyNoteNode[]): {
  years: WeeklyYearGroup[]
  undated: WeeklyNoteNode[]
} {
  const years: WeeklyYearGroup[] = []
  const undated: WeeklyNoteNode[] = []
  for (const node of nodes) {
    if (node.week === null) {
      undated.push(node)
      continue
    }
    const d = dayjs(node.week)
    let year = years.find((y) => y.year === d.year())
    if (!year) {
      year = { year: d.year(), months: [] }
      years.push(year)
    }
    const key = d.format('YYYY-MM')
    let month = year.months.find((m) => m.key === key)
    if (!month) {
      month = { key, label: d.format('MMMM'), notes: [] }
      year.months.push(month)
    }
    month.notes.push(node)
  }
  return { years, undated }
}

/**
 * The format "Organize Weekly Notes into Folders" switches a vault to: a flat
 * format keeps its file naming and gains year / month folders; one that
 * already makes folders is left as the user wrote it.
 */
export function folderedFormat(format: string): string {
  return format.includes('/') ? format : `YYYY/MM MMMM/${format}`
}

export interface PlannedWeeklyMove {
  from: VaultPath
  to: VaultPath
}

/**
 * Where each weekly note *should* live under `format` — the folders the
 * format's directory part names for that note's week — keeping its file name
 * unchanged (duplicate " 1" copies included), so `[[2026-10-12]]` links still
 * resolve. Notes already in place and undated names are left alone; a move
 * whose target is taken (by an existing note or an earlier move) is reported
 * in `blocked` rather than renamed, so nothing is ever silently uniquified.
 */
export function plannedWeeklyMoves(
  notes: Iterable<NoteMeta>,
  opts: { folder: string; format: string }
): { moves: PlannedWeeklyMove[]; blocked: VaultPath[] } {
  const all = [...notes].map((m) => m.path)
  const taken = new Set(all.map((p) => p.toLowerCase()))
  const moves: PlannedWeeklyMove[] = []
  const blocked: VaultPath[] = []
  for (const from of all) {
    if (!isInside(from, opts.folder) || samePath(from, opts.folder)) continue
    const week = weekOf(from, opts.format)
    if (week === null) continue
    const dir = parentOf(dayjs(week).format(opts.format))
    const to = joinRel(opts.folder, dir, nameOf(from))
    if (samePath(from, to)) continue
    if (taken.has(to.toLowerCase())) {
      blocked.push(from)
      continue
    }
    taken.add(to.toLowerCase())
    moves.push({ from, to })
  }
  return { moves, blocked }
}
