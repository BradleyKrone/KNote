// "Where was I?" — the Home page's previous-day card.
//
// A weekly note's `{{weekdays}}` template expands to one `### M/D/YYYY (dddd)`
// heading per day (see weekdaysBlock in extension/commands/templates.ts), and
// that heading's section is the day's journal. This finds the most recent day
// before today whose section actually has something written under it — on a
// Monday that skips an empty weekend and lands on Friday, in last week's note.
// Pure, so the host handler and the unit tests share it.

import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import type { NoteMeta, VaultConfig, VaultPath } from './types'
import { headingSectionEnd } from './embedSlice'
import { isInside, joinRel, nameOf } from './pathUtils'
import { resolveTarget } from './wikiResolve'

dayjs.extend(isoWeek)

/** How far back to look for a day with something written under it. */
const LOOKBACK_DAYS = 14

export interface PreviousDay {
  /** The day, YYYY-MM-DD. */
  date: string
  /** The weekly note it was found in. */
  path: VaultPath
  /** 0-based line of the day's heading, so the card can open the note right there. */
  line: number
  /** The section's markdown, heading excluded, surrounding blank lines trimmed. */
  content: string
}

/**
 * Where the weekly note covering `date` (YYYY-MM-DD) lives — named after its
 * ISO week's Monday. A `/` in the format makes folders: the default
 * `YYYY/MM MMMM/YYYY-M-D` files a note as `Weekly/2026/10 October/2026-10-12.md`,
 * so the weekly folder never grows into one endless flat list.
 */
export function weeklyPathFor(
  date: string,
  config: Pick<VaultConfig, 'weeklyFolder' | 'weeklyFormat'>
): VaultPath {
  const name = dayjs(date).startOf('isoWeek').format(config.weeklyFormat)
  return joinRel(config.weeklyFolder, name + '.md')
}

/** The file-name part of a weekly format — everything after its last `/`. */
export function weeklyFileFormat(format: string): string {
  return format.slice(format.lastIndexOf('/') + 1)
}

/**
 * The existing weekly note covering `date`, or null. Tries the path the
 * current format names first, then any note under the weekly folder with the
 * right *file name* — a note written before the folders existed (or under an
 * older format) still counts as that week's note, rather than this week
 * getting a second copy beside it and the Home page losing last week.
 */
export function findWeeklyNote(
  date: string,
  config: Pick<VaultConfig, 'weeklyFolder' | 'weeklyFormat'>,
  notes: Map<string, NoteMeta>
): VaultPath | null {
  const expected = weeklyPathFor(date, config)
  const exact = resolveTarget(expected, notes)
  if (exact !== null) return exact
  const name = nameOf(expected).toLowerCase()
  for (const path of notes.keys()) {
    if (nameOf(path).toLowerCase() === name && isInside(path, config.weeklyFolder)) return path
  }
  return null
}

/** True when a heading's text names `date` the way weekdaysBlock writes it (`M/D/YYYY`, then anything). */
function headingNamesDay(text: string, date: string): boolean {
  const day = dayjs(date).format('M/D/YYYY')
  return text.trim() === day || text.trim().startsWith(day + ' ')
}

/**
 * The most recent day before `today` (YYYY-MM-DD) with a non-empty section in
 * its weekly note, or null when none of the last two weeks has one.
 * `contentOf` returns a note's current text, or undefined if it can't be read.
 */
export function findPreviousDay(
  notes: Map<string, NoteMeta>,
  contentOf: (path: VaultPath) => string | undefined,
  config: Pick<VaultConfig, 'weeklyFolder' | 'weeklyFormat'>,
  today: string
): PreviousDay | null {
  const linesByPath = new Map<VaultPath, string[] | null>()
  for (let back = 1; back <= LOOKBACK_DAYS; back++) {
    const date = dayjs(today).subtract(back, 'day').format('YYYY-MM-DD')
    const path = findWeeklyNote(date, config, notes)
    if (path === null) continue
    const meta = notes.get(path)
    if (!meta) continue
    const heading = meta.headings.find((h) => headingNamesDay(h.text, date))
    if (!heading) continue

    if (!linesByPath.has(path)) {
      const content = contentOf(path)
      linesByPath.set(path, content === undefined ? null : content.split(/\r?\n/))
    }
    const lines = linesByPath.get(path)
    if (!lines || heading.line >= lines.length) continue

    const end = headingSectionEnd(meta, heading.line, heading.level, lines.length)
    const body = lines.slice(heading.line + 1, end)
    while (body.length > 0 && body[0].trim() === '') body.shift()
    while (body.length > 0 && body[body.length - 1].trim() === '') body.pop()
    if (body.length === 0) continue
    return { date, path, line: heading.line, content: body.join('\n') }
  }
  return null
}
