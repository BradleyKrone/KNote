// Uri ↔ vault-relative path translation for the extension host.

import * as vscode from 'vscode'
import { relative, sep } from 'path'
import type { VaultPath } from '@shared/types'
import { isMarkdown, normalizeRel } from '@shared/pathUtils'
import { isIgnoredRel, toAbs } from '../core/vaultService'
import { currentVaultRoot } from './engine'

export function uriForRel(rel: VaultPath): vscode.Uri {
  return vscode.Uri.file(toAbs(rel))
}

/** Vault-relative path for a Uri, or null when it's outside the open vault. */
export function relForUri(uri: vscode.Uri): VaultPath | null {
  const root = currentVaultRoot()
  if (!root || uri.scheme !== 'file') return null
  const rel = relative(root, uri.fsPath)
  if (rel === '' || rel.startsWith('..') || rel.includes('..' + sep)) return null
  return normalizeRel(rel)
}

/** Vault-relative path for a markdown document inside the vault, else null. */
export function vaultNoteRel(doc: vscode.TextDocument): VaultPath | null {
  if (doc.languageId !== 'markdown') return null
  const rel = relForUri(doc.uri)
  if (rel === null || !isMarkdown(rel) || isIgnoredRel(rel)) return null
  return rel
}

/** The open TextDocument for a vault path, if VS Code currently has it loaded. */
export function openDocFor(rel: VaultPath): vscode.TextDocument | undefined {
  const abs = toAbs(rel).toLowerCase()
  return vscode.workspace.textDocuments.find(
    (d) => d.uri.scheme === 'file' && !d.isClosed && d.uri.fsPath.toLowerCase() === abs
  )
}
