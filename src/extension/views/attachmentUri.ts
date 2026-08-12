// Resolving a note-relative image / draw.io reference for a webview.
//
// Lives apart from any one panel because two panels need it now: the Live
// Preview editor, which knows exactly which note it is showing, and the board,
// whose task editor renders a card's block — and a board's cards come from
// many notes, so it has no single note to resolve against. Both handlers take
// the note as an argument instead, `null` meaning "the reference is already
// vault-root-relative" (what the webview sends after resolving it itself
// against the card's own note — see resolveEmbedPath, which treats a leading
// `/` as vault-root-relative).

import * as vscode from 'vscode'
import { isImage, resolveEmbedPath } from '@shared/pathUtils'
import { toAbs } from '../../core/vaultService'

/** The folder a note-relative reference resolves against, given the note's own vault path. */
function folderOf(noteRel: string | null): string {
  return noteRel && noteRel.includes('/') ? noteRel.slice(0, noteRel.lastIndexOf('/')) : ''
}

/**
 * Resolve a note-relative image/embed reference to a webview-safe URI, with
 * the file's mtime appended as a cache-busting query param. Without it, a
 * widget that reloads the same path after the file changed on disk (e.g. a
 * draw.io diagram edited and saved in its own editor) can get served stale
 * bytes straight out of the webview's resource cache — same URL in, same
 * cached response out.
 */
export async function attachmentUriFor(
  src: string,
  noteRel: string | null,
  webview: vscode.Webview
): Promise<string | null> {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src // data:, already a URI
  const rel = resolveEmbedPath(folderOf(noteRel), src)
  if (!rel || !isImage(rel)) return null
  try {
    const fileUri = vscode.Uri.file(toAbs(rel))
    const stat = await vscode.workspace.fs.stat(fileUri)
    const uri = webview.asWebviewUri(fileUri).toString()
    return `${uri}${uri.includes('?') ? '&' : '?'}v=${stat.mtime}`
  } catch {
    return null // escapes the vault, or doesn't exist
  }
}

const DRAWIO_EXTENSION_ID = 'hediet.vscode-drawio'
// Verified against hediet.vscode-drawio's own package.json: the text-based
// editor handles .drawio/.drawio.svg (and .dio/.dio.svg), the binary one
// handles .drawio.png/.dio.png.
const DRAWIO_TEXT_VIEW_TYPE = 'hediet.vscode-drawio-text'
const DRAWIO_BINARY_VIEW_TYPE = 'hediet.vscode-drawio'

/** Resolve a note-relative draw.io reference to an absolute file Uri, or null if it escapes the vault. */
function resolveDrawioUri(src: string, noteRel: string | null): vscode.Uri | null {
  const rel = resolveEmbedPath(folderOf(noteRel), src)
  if (!rel) return null
  try {
    return vscode.Uri.file(toAbs(rel))
  } catch {
    return null
  }
}

/**
 * Open a draw.io diagram (an absolute file Uri) in the Draw.io Integration
 * extension's editor. KNote never bundles that editor itself (see
 * CLAUDE.md's offline rule) — if the extension isn't installed, this prompts
 * rather than doing nothing silently. Shared by the RPC handler below and by
 * the "Insert Draw.io Diagram" command, which already has an absolute Uri
 * for the file it just created.
 */
export async function openDrawioUri(uri: vscode.Uri): Promise<void> {
  if (!vscode.extensions.getExtension(DRAWIO_EXTENSION_ID)) {
    const action = await vscode.window.showWarningMessage(
      'KNote: editing draw.io diagrams needs the Draw.io Integration extension.',
      'Search Marketplace'
    )
    if (action) {
      void vscode.commands.executeCommand('workbench.extensions.search', DRAWIO_EXTENSION_ID)
    }
    return
  }
  const viewType = uri.path.toLowerCase().endsWith('.png')
    ? DRAWIO_BINARY_VIEW_TYPE
    : DRAWIO_TEXT_VIEW_TYPE
  await vscode.commands.executeCommand('vscode.openWith', uri, viewType)
}

/** Resolve a note-relative draw.io reference (from a webview's RPC) and open it. */
export async function openWithDrawio(src: string, noteRel: string | null): Promise<void> {
  const uri = resolveDrawioUri(src, noteRel)
  if (!uri) return
  await openDrawioUri(uri)
}
