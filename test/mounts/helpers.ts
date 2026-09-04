// Shared helpers for the multi-folder ("mounted folders") integration tests.
// These run in a real Extension Development Host opened on a generated
// .code-workspace with two folders: the vault, and an unrelated folder that
// KNote should mount into it. Black-box like the rest of the harness — only
// `vscode` and Node built-ins, never app source.

import * as vscode from 'vscode'
import { promises as fs } from 'fs'
import { basename } from 'path'

export {
  activateExtension,
  closeAllEditors,
  delay,
  openNoteAtLine,
  waitFor
} from '../integration/helpers'

/** The vault folder — the first of the workspace's two folders. */
export function vaultRoot(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) throw new Error('no workspace folder open — check .vscode-test.mjs')
  return folder.uri
}

/** The second workspace folder, the one KNote mounts into the vault. */
export function mountRoot(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[1]
  if (!folder) {
    throw new Error(
      'expected a second workspace folder — the mounts suite must run against ' +
        'test/.tmp-mounted.code-workspace, not a single folder'
    )
  }
  return folder.uri
}

/** The vault path a mounted file has: the mount folder's name, then its own path. */
export function mountName(): string {
  return basename(mountRoot().fsPath)
}

/** Absolute Uri for a path inside the mounted folder ("docs/Mounted Note.md"). */
export function mountUri(relPath: string): vscode.Uri {
  return vscode.Uri.joinPath(mountRoot(), ...relPath.split('/'))
}

/** Absolute Uri for a path inside the vault. */
export function vaultUri(relPath: string): vscode.Uri {
  return vscode.Uri.joinPath(vaultRoot(), ...relPath.split('/'))
}

/** Read a file inside the mounted folder straight from disk. */
export async function readMountedOnDisk(relPath: string): Promise<string> {
  return fs.readFile(mountUri(relPath).fsPath, 'utf-8')
}

export async function writeMountedOnDisk(relPath: string, content: string): Promise<void> {
  await fs.writeFile(mountUri(relPath).fsPath, content, 'utf-8')
}

export async function existsOnDisk(uri: vscode.Uri): Promise<boolean> {
  try {
    await fs.stat(uri.fsPath)
    return true
  } catch {
    return false
  }
}

/**
 * The vault path a `[[wiki link]]` in `noteUri` resolves to, or null while it
 * is still unresolved. Read from the DocumentLink tooltip, which the provider
 * writes as `Open "<vault path>"` — a read-only probe, unlike following the
 * link, which *creates* the note when the target does not resolve.
 */
export async function linkResolvesTo(noteUri: vscode.Uri): Promise<string | null> {
  const doc = await vscode.workspace.openTextDocument(noteUri)
  const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>(
    'vscode.executeLinkProvider',
    doc.uri
  )
  const tooltip = links?.[0]?.tooltip ?? ''
  const match = /^Open "(.+)"$/.exec(tooltip)
  return match ? match[1] : null
}
