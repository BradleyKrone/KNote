// Uri ↔ vault-relative path translation for the extension host.

import * as vscode from 'vscode'
import type { VaultPath } from '@shared/types'
import { isMarkdown } from '@shared/pathUtils'
import { isIgnoredRel, relForAbs, toAbs } from '../core/vaultService'

export function uriForRel(rel: VaultPath): vscode.Uri {
  return vscode.Uri.file(toAbs(rel))
}

/**
 * Vault-relative path for a Uri, or null when it's outside every folder the
 * vault spans. A file in a mounted folder comes back prefixed with that
 * mount's name, so callers can't tell it apart from a note in the vault proper.
 * `null` for a root itself — a root is not a note or an entry within one.
 */
export function relForUri(uri: vscode.Uri): VaultPath | null {
  if (uri.scheme !== 'file') return null
  const rel = relForAbs(uri.fsPath)
  return rel === null || rel === '' ? null : rel
}

/** Vault-relative path for a markdown document inside the vault, else null. */
export function vaultNoteRel(doc: vscode.TextDocument): VaultPath | null {
  if (doc.languageId !== 'markdown') return null
  const rel = relForUri(doc.uri)
  if (rel === null || !isMarkdown(rel) || isIgnoredRel(rel)) return null
  return rel
}

/**
 * Vault-relative path for the note a tab is showing, else null. Covers both the
 * plain text editor and the live-preview custom editor, which are different tab
 * input types over the same underlying `.md` file.
 */
export function tabNoteRel(tab: vscode.Tab): VaultPath | null {
  const input = tab.input
  const uri =
    input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom
      ? input.uri
      : null
  if (!uri) return null
  const rel = relForUri(uri)
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
