// Auto attachment cleanup, editor half: when saving a note removes the last
// reference to an image in the attachments folder, the image is moved to the
// OS trash (core/attachmentCleanup skips images other notes still embed).
// Diffs are taken save-to-save — a baseline of each note's text is kept from
// open/last save, so cutting an embed and pasting it back before saving never
// touches anything. External (non-editor) changes and note deletions are
// handled by the watcher path in engine.ts; the manual "Clean Up Orphaned
// Attachments" command remains as a backstop for anything both paths miss.

import * as vscode from 'vscode'
import { cleanupRemovedAttachments } from '../core/attachmentCleanup'
import { vaultNoteRel } from './paths'

export function registerAttachmentAutoCleanup(context: vscode.ExtensionContext): void {
  const baselines = new Map<string, string>()

  const seed = (doc: vscode.TextDocument): void => {
    const rel = vaultNoteRel(doc)
    if (rel !== null && !baselines.has(rel)) baselines.set(rel, doc.getText())
  }
  vscode.workspace.textDocuments.forEach(seed)

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(seed),

    vscode.workspace.onDidSaveTextDocument((doc) => {
      const rel = vaultNoteRel(doc)
      if (rel === null) return
      const oldContent = baselines.get(rel)
      const newContent = doc.getText()
      baselines.set(rel, newContent)
      void cleanupRemovedAttachments(rel, oldContent, newContent)
    }),

    vscode.workspace.onDidCloseTextDocument((doc) => {
      const rel = vaultNoteRel(doc)
      if (rel !== null) baselines.delete(rel)
    }),

    { dispose: () => baselines.clear() }
  )
}
