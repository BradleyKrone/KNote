// "Insert Video…" — pick a video file from anywhere on disk, copy it into the
// vault's attachments folder (so the note and its video travel together),
// and embed it as `![[/…/clip.mp4]]`. The live-preview editor reaches the
// same dialog + copy through the `importVideo` host RPC; this command is the
// entry point for the plain text editor and the command palette.

import * as vscode from 'vscode'
import type { VaultPath } from '@shared/types'
import { VIDEO_EXTS } from '@shared/pathUtils'
import { wrapEmbedForInsertion } from '@shared/embedInsert'
import { importAttachment } from '../../core/attachments'
import { vaultNoteRel } from '../paths'

/** Show the open dialog and copy the chosen video in. Null when cancelled. */
export async function pickAndImportVideo(noteRel: VaultPath | null): Promise<VaultPath | null> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Import Video',
    title: 'KNote: Import Video',
    filters: { Videos: [...VIDEO_EXTS] }
  })
  const file = picked?.[0]
  if (!file) return null
  try {
    return await importAttachment(file.fsPath, noteRel)
  } catch (err) {
    void vscode.window.showErrorMessage(`KNote: couldn't import the video — ${String(err)}`)
    return null
  }
}

async function insertVideo(): Promise<void> {
  const editor = vscode.window.activeTextEditor
  const noteRel = editor ? vaultNoteRel(editor.document) : null
  if (!editor || noteRel === null) {
    void vscode.window.showWarningMessage('KNote: open a note to insert a video into.')
    return
  }
  const saved = await pickAndImportVideo(noteRel)
  if (!saved) return

  const pos = editor.selection.active
  const line = editor.document.lineAt(pos.line)
  const insert = wrapEmbedForInsertion(line.text, pos.character, `![[/${saved}]]`)
  await editor.edit((b) => b.insert(pos, insert))
}

export function registerVideoCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('knote.insertVideo', insertVideo))
}
