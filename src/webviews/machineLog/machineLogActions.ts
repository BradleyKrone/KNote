import { MACHINE_ENTRY_RE } from '@shared/parser/patterns'
import { setDueDate } from '../shared/taskMeta'
import { rewriteLine, setLineDate } from '../shared/dateLineEdit'
import type { MachineEntry } from './machineLogSelectors'

/** Change a machine-log entry's 📅 date in place (or clear it when `date` is null). */
export async function setMachineEntryDate(entry: MachineEntry, date: string | null): Promise<void> {
  await setLineDate({ path: entry.path, line: entry.line, rawLine: entry.rawLine }, date)
}

/** Change a machine-log entry's serial and date together, leaving inline tags/text untouched. */
export async function setMachineEntryFields(
  entry: MachineEntry,
  serial: string,
  date: string | null
): Promise<void> {
  const m = MACHINE_ENTRY_RE.exec(entry.rawLine)
  if (!m) return
  const rest = setDueDate(m[2], date)
  const newLine = rest ? `🚜 ${serial} ${rest}` : `🚜 ${serial}`
  await rewriteLine({ path: entry.path, line: entry.line, rawLine: entry.rawLine }, newLine)
}
