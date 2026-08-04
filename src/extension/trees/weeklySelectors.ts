// Pure ordering for the "This Week" tree. No `vscode` import, so vitest can
// exercise the date parsing and ordering directly — weeklyTree.ts only turns
// these into TreeItems.

import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import type { NoteMeta, VaultPath } from '@shared/types'

dayjs.extend(customParseFormat)

export interface WeeklyNoteNode {
  path: VaultPath
  title: string
}

/** "Weekly/2026-7-6 1.md" → "2026-7-6 1" */
function baseName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1)
  return file.replace(/\.md$/i, '')
}

/**
 * The week a note belongs to, read from its file name via the vault's
 * `weeklyFormat`. A trailing " 1" (the duplicate-name suffix) is tolerated, so
 * a second copy of a week still files under that week. Returns null when the
 * name isn't a date at all.
 */
export function weekOf(path: string, format: string): number | null {
  const name = baseName(path)
  for (const candidate of [name, name.replace(/\s+\d+$/, '')]) {
    const d = dayjs(candidate, format, true)
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
        a.meta.path.length - b.meta.path.length ||
        a.meta.path.localeCompare(b.meta.path)
      )
    })
    .map(({ meta }) => ({ path: meta.path, title: meta.title }))
}
