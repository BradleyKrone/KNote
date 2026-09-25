// Reading a 🚜 machine entry into the entry popup and planning the line edits
// that save it back — shared by the live-preview editor's "Edit machine entry…"
// (applied as one CodeMirror transaction) and the Machine Log's right-click edit
// (applied through the host's verified line edits). Pure, no CodeMirror or RPC,
// so the Machine Log bundle doesn't drag the editor in.

import {
  owningMachineEntry,
  parseMachineDetail,
  planMachineEntryBlock,
  softwareFromItems,
  type BlockEdit,
  type MachineSoftware
} from '@shared/machineSoftware'
import { DUE_RE, MACHINE_ENTRY_RE } from '@shared/parser/patterns'
import { setDueDate } from './taskMeta'

const clean = (line: string): string => line.replace(/\r$/, '')

/** Rewrite a machine line's serial + date, leaving inline tags/activity text intact. */
export function editMachineLine(rawLine: string, serial: string, date: string | null): string {
  const m = MACHINE_ENTRY_RE.exec(rawLine)
  if (!m) return rawLine
  const rest = setDueDate(m[3], date)
  return rest ? `${m[1]}🚜 ${serial} ${rest}` : `${m[1]}🚜 ${serial}`
}

/** Everything the entry popup needs about the 🚜 entry owning a line. */
export interface MachineEntryCtx {
  /** The entry line, 0-based */
  line0: number
  rawLine: string
  serial: string
  due: string | null
  software: MachineSoftware
}

/**
 * The 🚜 entry whose block holds `line0` — the entry line itself or any of its
 * software/Notes lines — read into the popup's fields, or null.
 */
export function readMachineEntryCtx(
  lines: readonly string[],
  line0: number
): MachineEntryCtx | null {
  const entry = owningMachineEntry(lines, line0)
  if (entry === null) return null
  const rawLine = clean(lines[entry])
  const due = DUE_RE.exec(rawLine)
  return {
    line0: entry,
    rawLine,
    serial: MACHINE_ENTRY_RE.exec(rawLine)?.[2] ?? '',
    due: due ? (due[1] ?? due[2]) : null,
    software: softwareFromItems(parseMachineDetail(lines, entry))
  }
}

/**
 * The one block edit that saves the popup back to an entry — its serial + date
 * on the 🚜 line, its software in the table below (see planMachineEntryBlock)
 * — or null when nothing changed.
 */
export function planMachineEntryEdit(
  lines: readonly string[],
  entryLine: number,
  serial: string,
  date: string | null,
  software: MachineSoftware
): BlockEdit | null {
  const raw = clean(lines[entryLine])
  const current = readMachineEntryCtx(lines, entryLine)
  // Only rewrite the 🚜 line when serial or date actually changed — the date
  // rewrite moves 📅 to the end, which would churn an untouched line.
  const unchanged = current !== null && current.serial === serial && current.due === date
  const newLine = unchanged ? raw : editMachineLine(raw, serial, date)
  return planMachineEntryBlock(lines, entryLine, newLine, software)
}
