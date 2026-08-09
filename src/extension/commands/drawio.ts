// "Insert Draw.io Diagram" — creates an empty draw.io diagram in the vault's
// attachments folder (the same "editable image" .drawio.svg format the
// Draw.io Integration extension itself writes for its own "New Diagram"
// command), embeds it in the active note, and opens it for editing.

import * as vscode from 'vscode'
import dayjs from 'dayjs'
import { joinRel } from '@shared/pathUtils'
import { wrapEmbedForInsertion } from '@shared/embedInsert'
import { getVaultConfig } from '../../core/vaultConfig'
import * as vault from '../../core/vaultService'
import { uriForRel, vaultNoteRel } from '../paths'
import { openDrawioUri } from '../views/liveEditorProvider'

async function insertDrawioDiagram(): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor || vaultNoteRel(editor.document) === null) {
    void vscode.window.showWarningMessage('KNote: open a note to insert a diagram into.')
    return
  }

  const name = await vscode.window.showInputBox({
    prompt: 'Diagram name',
    value: `Diagram ${dayjs().format('YYYY-MM-DD HHmmss')}`
  })
  if (!name) return

  const config = await getVaultConfig()
  // Empty, same as the Draw.io Integration extension's own "New Diagram"
  // command writes for a fresh .drawio file — its editor treats an empty
  // document as a blank canvas.
  const saved = await vault.createBinaryFile(
    joinRel(config.attachmentsFolder, `${name}.drawio.svg`),
    Buffer.alloc(0)
  )

  const pos = editor.selection.active
  const line = editor.document.lineAt(pos.line)
  const embed = `![[/${saved}]]`
  const insert = wrapEmbedForInsertion(line.text, pos.character, embed)
  await editor.edit((b) => b.insert(pos, insert))

  await openDrawioUri(uriForRel(saved))
}

export function registerDrawioCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('knote.insertDrawioDiagram', insertDrawioDiagram)
  )
}
