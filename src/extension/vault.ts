// Vault detection: a workspace folder is a KNote vault when it contains a
// `.knote/` directory. The first matching folder wins.

import * as vscode from 'vscode'
import { promises as fs } from 'fs'
import { join } from 'path'
import { DEFAULT_VAULT_CONFIG } from '@shared/types'

export async function findVaultRoot(): Promise<string | null> {
  const folders = vscode.workspace.workspaceFolders ?? []
  const matches: string[] = []
  for (const folder of folders) {
    if (folder.uri.scheme !== 'file') continue
    try {
      const stat = await fs.stat(join(folder.uri.fsPath, '.knote'))
      if (stat.isDirectory()) matches.push(folder.uri.fsPath)
    } catch {
      // no .knote here — not a vault
    }
  }
  if (matches.length > 1) {
    console.warn(`[knote] multiple vaults in workspace, using first: ${matches[0]}`)
  }
  return matches[0] ?? null
}

/**
 * Turn the first workspace folder into a vault by writing a default
 * `.knote/config.json`. No-ops on the config if one already exists.
 * Returns the vault root, or null if there is no usable workspace folder.
 */
export async function initializeVault(): Promise<string | null> {
  const folder = (vscode.workspace.workspaceFolders ?? []).find((f) => f.uri.scheme === 'file')
  if (!folder) {
    void vscode.window.showErrorMessage('KNote: open a folder first, then initialize it as a vault.')
    return null
  }
  const root = folder.uri.fsPath
  const configPath = join(root, '.knote', 'config.json')
  try {
    await fs.access(configPath)
  } catch {
    await fs.mkdir(join(root, '.knote'), { recursive: true })
    await fs.writeFile(configPath, JSON.stringify(DEFAULT_VAULT_CONFIG, null, 2), 'utf-8')
  }
  return root
}

/** Offer to initialize once per workspace when it looks like a note collection. */
export async function maybeSuggestInitialize(
  context: vscode.ExtensionContext,
  onInitialize: () => Promise<void>
): Promise<void> {
  const KEY = 'knote.suggestedInit'
  if (context.workspaceState.get<boolean>(KEY)) return
  const mdFiles = await vscode.workspace.findFiles('**/*.md', '**/node_modules/**', 1)
  if (mdFiles.length === 0) return
  await context.workspaceState.update(KEY, true)
  const pick = await vscode.window.showInformationMessage(
    'This workspace contains Markdown notes. Initialize it as a KNote vault to enable the Kanban board, wiki links, and search?',
    'Initialize vault',
    'Not now'
  )
  if (pick === 'Initialize vault') await onInitialize()
}
