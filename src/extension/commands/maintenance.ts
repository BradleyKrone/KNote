// Vault maintenance commands: the bundled welcome/feature guide and the
// orphaned-attachment cleanup.

import * as vscode from 'vscode'
import { findOrphanedAttachments } from '../../core/attachmentCleanup'
import * as vault from '../../core/vaultService'
import { currentVaultRoot } from '../engine'

async function openWelcome(context: vscode.ExtensionContext): Promise<void> {
  const uri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'welcome.md')
  await vscode.commands.executeCommand('markdown.showPreview', uri)
}

async function cleanupAttachments(): Promise<void> {
  if (!currentVaultRoot()) {
    void vscode.window.showWarningMessage('KNote: no vault is open in this workspace.')
    return
  }
  const orphans = await findOrphanedAttachments()
  if (orphans.length === 0) {
    void vscode.window.showInformationMessage('KNote: no orphaned attachments found.')
    return
  }
  const picked = await vscode.window.showQuickPick(
    orphans.map((rel) => ({ label: rel, picked: true })),
    {
      canPickMany: true,
      placeHolder: `${orphans.length} attachment${orphans.length === 1 ? '' : 's'} no note references — select which to move to the trash`
    }
  )
  if (!picked || picked.length === 0) return
  for (const item of picked) {
    try {
      await vault.deleteEntry(item.label)
    } catch {
      // already gone, or untrashable — skip
    }
  }
  void vscode.window.showInformationMessage(
    `KNote: moved ${picked.length} orphaned attachment${picked.length === 1 ? '' : 's'} to the trash.`
  )
}

export function registerMaintenanceCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('knote.openWelcome', () => openWelcome(context)),
    vscode.commands.registerCommand('knote.cleanupAttachments', cleanupAttachments)
  )
}
