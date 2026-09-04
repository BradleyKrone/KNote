// The two user-facing knobs for a multi-folder vault: which folder is the
// vault proper, and which of the others get mounted into it.

import * as vscode from 'vscode'
import { getVaultConfig, setVaultConfig } from '../core/vaultConfig'
import { currentVaultRoot } from './engine'
import { vaultCandidates } from './vault'

/**
 * Pick which `.knote/`-bearing folder is the vault. Only matters when a
 * workspace holds more than one — the loser is still mounted, it just stops
 * supplying the config, weekly notes and templates.
 */
export async function chooseVault(
  context: vscode.ExtensionContext,
  reopen: () => Promise<boolean>
): Promise<void> {
  const candidates = await vaultCandidates()
  if (candidates.length < 2) {
    void vscode.window.showInformationMessage(
      candidates.length === 1
        ? `KNote is using ${candidates[0]} as the vault — it is the only folder with a .knote/ folder.`
        : 'No folder in this workspace is a KNote vault yet. Run "KNote: Initialize Vault" first.'
    )
    return
  }
  const current = currentVaultRoot()
  const pick = await vscode.window.showQuickPick(
    candidates.map((root) => ({
      label: root,
      description: root === current ? 'current vault' : undefined
    })),
    { title: 'Which folder is the KNote vault?' }
  )
  if (!pick) return
  await context.workspaceState.update('knote.primaryVault', pick.label)
  await reopen()
}

/**
 * Tick the workspace folders that should be part of the vault. Stored as the
 * *excluded* set (`VaultConfig.excludedFolders`) so a folder added to the
 * workspace later joins on its own rather than staying invisible until someone
 * remembers to tick it.
 */
export async function manageMountedFolders(restart: () => void): Promise<void> {
  const root = currentVaultRoot()
  if (!root) {
    void vscode.window.showWarningMessage('KNote: no vault is open.')
    return
  }
  const folders = (vscode.workspace.workspaceFolders ?? [])
    .filter((f) => f.uri.scheme === 'file' && f.uri.fsPath !== root)
    .map((f) => f.uri.fsPath)
  if (folders.length === 0) {
    void vscode.window.showInformationMessage(
      'KNote: this workspace has no other folders. Add one with "File: Add Folder to Workspace…" and it joins the vault.'
    )
    return
  }

  const config = await getVaultConfig()
  const excluded = new Set(config.excludedFolders.map((p) => p.toLowerCase()))
  const picked = await vscode.window.showQuickPick(
    folders.map((path) => ({ label: path, picked: !excluded.has(path.toLowerCase()) })),
    {
      title: 'Folders included in this vault',
      canPickMany: true,
      placeHolder: 'Unticked folders are not indexed, searched, or shown on the board'
    }
  )
  if (!picked) return

  const keep = new Set(picked.map((p) => p.label.toLowerCase()))
  const nextExcluded = [
    // Folders no longer in the workspace keep their exclusion, so removing and
    // re-adding one doesn't silently opt it back in.
    ...config.excludedFolders.filter(
      (p) => !folders.some((f) => f.toLowerCase() === p.toLowerCase())
    ),
    ...folders.filter((f) => !keep.has(f.toLowerCase()))
  ]
  await setVaultConfig({ ...config, excludedFolders: nextExcluded })
  restart()
}
