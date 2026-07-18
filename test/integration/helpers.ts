// Shared helpers for the KNote VS Code integration tests. These run inside a
// real Extension Development Host (see `.vscode-test.mjs`), so they talk to the
// live `vscode` API and to the disposable vault on disk — no app source is
// imported, keeping the harness independent of how the extension is bundled.

import * as vscode from 'vscode'
import { promises as fs } from 'fs'

/** The workspace folder the harness opened — a fresh copy of test/fixtures/vault. */
export function vaultRoot(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) throw new Error('no workspace folder open — check .vscode-test.mjs workspaceFolder')
  return folder.uri
}

/** Absolute Uri for a vault-relative path (POSIX-style, e.g. "Sample.md"). */
export function vaultUri(relPath: string): vscode.Uri {
  return vscode.Uri.joinPath(vaultRoot(), ...relPath.split('/'))
}

/** Read a note's bytes straight from disk (bypasses any open buffer). */
export async function readNoteOnDisk(relPath: string): Promise<string> {
  return fs.readFile(vaultUri(relPath).fsPath, 'utf-8')
}

/** Write a note to disk and return once it exists (test setup helper). */
export async function writeNoteOnDisk(relPath: string, content: string): Promise<void> {
  await fs.writeFile(vaultUri(relPath).fsPath, content, 'utf-8')
}

/**
 * Force KNote to activate and its engine to bind to the vault. Opening any
 * markdown document satisfies the `onLanguage:markdown` activation event, and
 * the fixture ships a `.knote/` folder so the vault is detected on start.
 */
export async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const ext = vscode.extensions.getExtension('bradleykrone.knote')
  if (!ext) throw new Error('KNote extension not found — did `npm run build` run first?')
  if (!ext.isActive) await ext.activate()
  return ext
}

/** Open a note in an editor and put the cursor on `line` (0-based). */
export async function openNoteAtLine(relPath: string, line: number): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument(vaultUri(relPath))
  const editor = await vscode.window.showTextDocument(doc)
  const pos = new vscode.Position(line, 0)
  editor.selection = new vscode.Selection(pos, pos)
  return editor
}

/** Sleep for `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Poll `predicate` until it returns true (or a truthy value) or the timeout
 * elapses. Integration timing is inherently async — editor edits, disk writes,
 * and the watcher all settle a beat after a command returns — so assert on a
 * condition converging rather than on a fixed sleep.
 */
export async function waitFor<T>(
  predicate: () => T | Promise<T>,
  { timeout = 5000, interval = 50, message = 'condition' }: {
    timeout?: number
    interval?: number
    message?: string
  } = {}
): Promise<T> {
  const start = Date.now()
  let last: T
  for (;;) {
    last = await predicate()
    if (last) return last
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor timed out after ${timeout}ms waiting for ${message}`)
    }
    await delay(interval)
  }
}

/** Close all editors without triggering a save prompt (revert first). */
export async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
}
