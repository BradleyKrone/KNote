// Shared "change the 📅 date on one exact source line" rewrite, used by any
// calendar-picker date edit (Timeline tasks/milestones, the Machine Log).
// The host's verifiedEdit routes it into the live buffer when the note is
// open, or a verified disk write otherwise — KNOTE_STALE aborts either way.

import type { VaultPath } from '@shared/types'
import { isStaleError } from '@shared/errors'
import { host } from './rpc'
import { showToast } from './stores'
import { setDueDate } from './taskMeta'

export interface DateLineTarget {
  path: VaultPath
  line: number
  rawLine: string
}

/** Verified rewrite of one exact source line to `newLine` (no-op if unchanged). */
export async function rewriteLine(target: DateLineTarget, newLine: string): Promise<void> {
  if (newLine === target.rawLine) return
  try {
    await host.replaceLine(target.path, target.line, target.rawLine, newLine)
  } catch (err) {
    if (isStaleError(err)) showToast('Note changed on disk — refreshed')
    else throw err
  }
}

/** Change a line's 📅 date in place (or clear it when `date` is null). */
export async function setLineDate(target: DateLineTarget, date: string | null): Promise<void> {
  await rewriteLine(target, setDueDate(target.rawLine, date))
}
