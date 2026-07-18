import type * as vscode from 'vscode'
import { registerTaskCommands } from './tasks'
import { registerFormattingCommands } from './formatting'
import { registerTemplateCommands } from './templates'
import { registerWeeklyNoteCommands } from './weeklyNotes'
import { registerMachineEntryCommands } from './machineEntry'
import { registerMaintenanceCommands } from './maintenance'

export function registerAllCommands(context: vscode.ExtensionContext): void {
  registerTaskCommands(context)
  registerFormattingCommands(context)
  registerTemplateCommands(context)
  registerWeeklyNoteCommands(context)
  registerMachineEntryCommands(context)
  registerMaintenanceCommands(context)
}
