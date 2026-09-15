import { MACHINE_ENTRY_RE } from '@shared/parser/patterns'
import { setDueDate } from '../shared/taskMeta'
import { rewriteLine } from '../shared/dateLineEdit'
import type { MachineEntry } from './machineLogSelectors'

/** Change a machine-log entry's serial and date together, leaving inline tags/text untouched. */
export async function setMachineEntryFields(
  entry: MachineEntry,
  serial: string,
  date: string | null
): Promise<void> {
  const m = MACHINE_ENTRY_RE.exec(entry.rawLine)
  if (!m) return
  const rest = setDueDate(m[3], date)
  const newLine = rest ? `${m[1]}🚜 ${serial} ${rest}` : `${m[1]}🚜 ${serial}`
  await rewriteLine({ path: entry.path, line: entry.line, rawLine: entry.rawLine }, newLine)
}
