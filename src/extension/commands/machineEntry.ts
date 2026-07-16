// Insert a 🚜 machine work-log entry at the cursor: pick a registered
// machine (from Settings → Machines in .knote/config.json) or type a serial,
// then a dated entry line plus the blank detail template is inserted.

import * as vscode from 'vscode'
import dayjs from 'dayjs'
import { machineEntryTemplate } from '@shared/machineEntry'
import { getVaultConfig } from '../../core/vaultConfig'
import { vaultNoteRel } from '../paths'

async function pickSerial(): Promise<string | undefined> {
  const config = await getVaultConfig()
  if (config.machines.length === 0) {
    return vscode.window.showInputBox({ prompt: 'Machine serial number' })
  }
  const OTHER = '$(edit) Other serial…'
  const picked = await vscode.window.showQuickPick(
    [
      ...config.machines.map((m) => ({
        label: m.serial,
        description: [m.model, ...m.attributes].filter(Boolean).join(' · ')
      })),
      { label: OTHER, description: 'Type a serial not in the registry' }
    ],
    { placeHolder: 'Which machine?' }
  )
  if (!picked) return undefined
  if (picked.label === OTHER) {
    return vscode.window.showInputBox({ prompt: 'Machine serial number' })
  }
  return picked.label
}

async function insertMachineEntry(): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor || vaultNoteRel(editor.document) === null) {
    void vscode.window.showWarningMessage('KNote: open a vault note first.')
    return
  }
  const serial = await pickSerial()
  if (!serial) return

  const pos = editor.selection.active
  const line = editor.document.lineAt(pos.line)
  const hasTextBefore = pos.character > 0
  const hasTextAfter = pos.character < line.text.length
  const prefix = `${hasTextBefore ? '\n' : ''}🚜 ${serial} 📅 ${dayjs().format('YYYY-MM-DD')} `
  const template = machineEntryTemplate()
  const suffix = hasTextAfter ? '\n' : ''
  await editor.edit((b) => b.insert(pos, prefix + template + suffix))

  // Caret at the end of the entry line (after the date), ready to type the activity
  const caretLine = pos.line + (hasTextBefore ? 1 : 0)
  const caretCol = (hasTextBefore ? 0 : pos.character) + prefix.length - (hasTextBefore ? 1 : 0)
  const caret = new vscode.Position(caretLine, caretCol)
  editor.selection = new vscode.Selection(caret, caret)
}

export function registerMachineEntryCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('knote.insertMachineEntry', insertMachineEntry)
  )
}
