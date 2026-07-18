// Timeline→file writes. Tasks/milestones go through the shared single-line
// date rewrite (dateLineEdit.ts); notes get their frontmatter-property line
// rewritten — the host decides buffer vs verified disk write either way.

import { isStaleError } from '@shared/errors'
import { host } from '../shared/rpc'
import { showToast } from '../shared/stores'
import { setLineDate } from '../shared/dateLineEdit'
import type { TimelineItem } from './timelineSelectors'

/** Change a task or milestone's 📅 date in place (or clear it when `date` is null). */
async function setLineItemDate(item: TimelineItem, date: string | null): Promise<void> {
  if (item.rawLine === undefined) return
  await setLineDate({ path: item.path, line: item.line, rawLine: item.rawLine }, date)
}

/** Locates a frontmatter `key: value` line in `lines` (the whole file, split into lines). */
function findFrontmatterKeyLine(lines: string[], key: string): number {
  if (lines[0]?.trim() !== '---') return -1
  const keyRe = new RegExp(`^${key}\\s*:`, 'i')
  for (let i = 1; i < Math.min(lines.length, 200); i++) {
    if (lines[i].trim() === '---') return -1
    if (keyRe.test(lines[i])) return i
  }
  return -1
}

/** Change a note's `date`/`due`/`deadline` frontmatter property (or remove it when `date` is null). */
async function setNoteFrontmatterDate(item: TimelineItem, date: string | null): Promise<void> {
  const key = item.frontmatterKey
  if (!key) return
  const newText = date === null ? null : `${key}: ${date}`

  try {
    const { content } = await host.readFile(item.path)
    const lines = content.split(/\r?\n/)
    const target = findFrontmatterKeyLine(lines, key)
    if (target === -1) return
    const expectedText = lines[target]
    if (newText === null) {
      await host.deleteLine(item.path, target, expectedText)
    } else if (newText !== expectedText) {
      await host.replaceLine(item.path, target, expectedText, newText)
    }
  } catch (err) {
    if (isStaleError(err)) showToast('Note changed on disk — timeline refreshed')
    else throw err
  }
}

/** Change any timeline item's date in place (or clear it when `date` is null), whatever its source. */
export async function setTimelineItemDate(item: TimelineItem, date: string | null): Promise<void> {
  if (item.kind === 'note') return setNoteFrontmatterDate(item, date)
  return setLineItemDate(item, date)
}
