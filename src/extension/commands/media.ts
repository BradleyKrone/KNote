// "Insert Image…" / "Insert Video…" — pick a file from anywhere on disk, copy
// it into the vault's attachments folder (so the note and its media travel
// together), and embed it as `![[/…/photo.png]]`. The live-preview editor
// reaches the same dialog + copy through the `importImage` / `importVideo`
// host RPCs; these commands are the entry point for the plain text editor and
// the command palette.

import * as vscode from 'vscode'
import type { VaultPath } from '@shared/types'
import { IMAGE_EXTS, VIDEO_EXTS } from '@shared/pathUtils'
import { wrapEmbedForInsertion } from '@shared/embedInsert'
import { importAttachment } from '../../core/attachments'
import { vaultNoteRel } from '../paths'

interface MediaKind {
  /** Lower-case noun for messages: "image", "video". */
  noun: string
  /** Title-case, for the dialog: "Image", "Video". */
  title: string
  exts: readonly string[]
}

const IMAGE: MediaKind = { noun: 'image', title: 'Image', exts: IMAGE_EXTS }
const VIDEO: MediaKind = { noun: 'video', title: 'Video', exts: VIDEO_EXTS }

/** Show the open dialog and copy the chosen file in. Null when cancelled. */
async function pickAndImport(
  kind: MediaKind,
  noteRel: VaultPath | null
): Promise<VaultPath | null> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: `Import ${kind.title}`,
    title: `KNote: Import ${kind.title}`,
    filters: { [`${kind.title}s`]: [...kind.exts] }
  })
  const file = picked?.[0]
  if (!file) return null
  try {
    return await importAttachment(file.fsPath, noteRel)
  } catch (err) {
    void vscode.window.showErrorMessage(`KNote: couldn't import the ${kind.noun} — ${String(err)}`)
    return null
  }
}

export const pickAndImportImage = (noteRel: VaultPath | null): Promise<VaultPath | null> =>
  pickAndImport(IMAGE, noteRel)

export const pickAndImportVideo = (noteRel: VaultPath | null): Promise<VaultPath | null> =>
  pickAndImport(VIDEO, noteRel)

async function insertMedia(kind: MediaKind): Promise<void> {
  const editor = vscode.window.activeTextEditor
  const noteRel = editor ? vaultNoteRel(editor.document) : null
  if (!editor || noteRel === null) {
    void vscode.window.showWarningMessage(
      `KNote: open a note to insert ${kind.noun === 'image' ? 'an' : 'a'} ${kind.noun} into.`
    )
    return
  }
  const saved = await pickAndImport(kind, noteRel)
  if (!saved) return

  const pos = editor.selection.active
  const line = editor.document.lineAt(pos.line)
  const insert = wrapEmbedForInsertion(line.text, pos.character, `![[/${saved}]]`)
  await editor.edit((b) => b.insert(pos, insert))
}

export function registerMediaCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('knote.insertImage', () => insertMedia(IMAGE)),
    vscode.commands.registerCommand('knote.insertVideo', () => insertMedia(VIDEO))
  )
}
