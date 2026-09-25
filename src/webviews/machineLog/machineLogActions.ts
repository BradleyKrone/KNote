import { isStaleError } from '@shared/errors'
import type { MachineSoftware } from '@shared/machineSoftware'
import { host } from '../shared/rpc'
import { showToast } from '../shared/stores'
import { planMachineEntryEdit } from '../shared/machineEntryEdit'
import type { MachineEntry } from './machineLogSelectors'

/**
 * Save the entry popup back to a machine-log entry: serial + date on its 🚜
 * line, software into the table below it — one verified block edit, so a
 * change made meanwhile refuses the whole write (KNOTE_STALE) rather than
 * landing half of it.
 */
export async function setMachineEntryFields(
  entry: MachineEntry,
  serial: string,
  date: string | null,
  software: MachineSoftware
): Promise<void> {
  try {
    const lines = (await host.readFile(entry.path)).content.split(/\r?\n/)
    if (lines[entry.line] !== entry.rawLine) {
      showToast('Note changed on disk — refreshed')
      return
    }
    const plan = planMachineEntryEdit(lines, entry.line, serial, date, software)
    if (plan) await host.replaceBlock(entry.path, plan.from, plan.expected, plan.next)
  } catch (err) {
    if (isStaleError(err)) showToast('Note changed on disk — refreshed')
    else throw err
  }
}
