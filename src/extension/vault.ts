// Vault detection. A workspace folder containing a `.knote/` directory is the
// vault; every *other* workspace folder is mounted into it as a virtual
// top-level folder (see `core/mounts.ts`), which is how a vault can span
// folders living on completely unrelated paths.

import * as vscode from 'vscode'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { DEFAULT_VAULT_CONFIG } from '@shared/types'

/** How the open workspace maps onto one vault. */
export interface VaultLayout {
  /** The folder holding `.knote/` — owns the config, weekly notes and templates. */
  readonly primary: string
  /** The other workspace folders, in workspace order, offered up for mounting. */
  readonly candidates: string[]
  /** Folders that also contain a `.knote/` but lost the primary slot; their config is ignored. */
  readonly otherVaults: string[]
}

function workspaceFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? [])
    .filter((f) => f.uri.scheme === 'file')
    .map((f) => f.uri.fsPath)
}

async function isVault(folder: string): Promise<boolean> {
  try {
    return (await fs.stat(join(folder, '.knote'))).isDirectory()
  } catch {
    return false
  }
}

/**
 * Work out the vault and the folders around it. `preferredPrimary` (persisted
 * per workspace by "KNote: Choose Primary Vault") wins when it still has a
 * `.knote/`; otherwise the first vault in workspace order does, so the answer
 * is stable and the user can change it by reordering the workspace.
 */
export async function findVaultLayout(preferredPrimary?: string): Promise<VaultLayout | null> {
  const folders = workspaceFolders()
  const vaults: string[] = []
  for (const folder of folders) {
    if (await isVault(folder)) vaults.push(folder)
  }
  if (vaults.length === 0) return null

  const preferred = vaults.find((v) => v.toLowerCase() === (preferredPrimary ?? '').toLowerCase())
  const primary = preferred ?? vaults[0]
  return {
    primary,
    candidates: folders.filter((f) => f !== primary),
    otherVaults: vaults.filter((v) => v !== primary)
  }
}

/** The folders that could be picked as the primary vault, for the chooser command. */
export async function vaultCandidates(): Promise<string[]> {
  const out: string[] = []
  for (const folder of workspaceFolders()) {
    if (await isVault(folder)) out.push(folder)
  }
  return out
}

/**
 * Turn a workspace folder into a vault by writing a default `.knote/config.json`.
 * No-ops on the config if one already exists. Returns the vault root, or null
 * if there is no usable workspace folder (or the user dismissed the picker).
 */
export async function initializeVault(): Promise<string | null> {
  const folders = workspaceFolders()
  if (folders.length === 0) {
    void vscode.window.showErrorMessage(
      'KNote: open a folder first, then initialize it as a vault.'
    )
    return null
  }

  // With several folders open, the first one is a coin flip — and picking wrong
  // writes a `.knote/` into, say, a git repo that was only meant to be mounted.
  let root = folders[0]
  if (folders.length > 1) {
    const existing = await findVaultLayout()
    if (existing) return existing.primary
    const pick = await vscode.window.showQuickPick(folders, {
      title: 'Which folder is your KNote vault?',
      placeHolder: 'The others will be mounted into it as folders'
    })
    if (!pick) return null
    root = pick
  }

  const configPath = join(root, '.knote', 'config.json')
  try {
    await fs.access(configPath)
  } catch {
    await fs.mkdir(join(root, '.knote'), { recursive: true })
    await fs.writeFile(configPath, JSON.stringify(DEFAULT_VAULT_CONFIG, null, 2), 'utf-8')
  }
  return root
}

/**
 * Vault-relative path of the living AI-instructions note KNote keeps in sync,
 * and the bundled resource it's sourced from. It lives under `Knote
 * Resources/` alongside Templates/Attachments — an app-managed area, not
 * user notes — because unlike everything else this file scaffolds
 * (`.knote/config.json`), it's meant to be overwritten whenever KNote's
 * bundled guide changes, not owned by the user. The user references it from
 * their own `CLAUDE.md` / `.github/copilot-instructions.md` (or a `[[wiki
 * link]]`) however suits their setup, instead of KNote guessing at and
 * clobbering files the user might already have of their own.
 */
const AI_INSTRUCTIONS_TARGET = join('Knote Resources', 'AI Instructions.md')
const AI_INSTRUCTIONS_RESOURCE = 'aiInstructions.md'

/**
 * Keep `Knote Resources/AI Instructions.md` in sync with KNote's bundled
 * guide to its own markdown conventions, so it always reflects the current
 * feature set — every new feature that adds user-facing syntax updates
 * `resources/aiInstructions.md`, and that change reaches every vault the
 * next time it's opened. A no-op when the file already matches (the common
 * case), so this doesn't touch disk — or the file watcher — on every
 * activation. Returns `true` only the first time the file is created, for a
 * one-time "here's what I added" notice; a later content refresh is silent.
 */
export async function syncAiInstructions(extensionUri: vscode.Uri, root: string): Promise<boolean> {
  let content: string
  try {
    content = await fs.readFile(
      vscode.Uri.joinPath(extensionUri, 'resources', AI_INSTRUCTIONS_RESOURCE).fsPath,
      'utf-8'
    )
  } catch {
    return false // best-effort: a missing bundled resource must never block the vault opening
  }

  const targetPath = join(root, AI_INSTRUCTIONS_TARGET)
  let existing: string | null = null
  try {
    existing = await fs.readFile(targetPath, 'utf-8')
  } catch {
    // doesn't exist yet
  }
  if (existing === content) return false

  try {
    await fs.mkdir(dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, content, 'utf-8')
  } catch {
    return false // unwritable — same best-effort rule
  }
  return existing === null
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
