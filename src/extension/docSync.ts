// Editor → index direction of the two-way sync: as the user types in a
// vault note, reparse it (debounced) and push the delta into the in-memory
// index so the board/views update live. On save, the saved text is recorded
// as known content so the chokidar watcher's byte-identical check suppresses
// the echo instead of reindexing (or double-reporting) our own save.

import * as vscode from 'vscode'
import * as vaultIndex from '../core/indexer/vaultIndex'
import { markKnownContent } from '../core/watcher'
import { toAbs } from '../core/vaultService'
import { vaultNoteRel } from './paths'

const DEBOUNCE_MS = 250

export function registerDocSync(context: vscode.ExtensionContext): void {
  const timers = new Map<string, NodeJS.Timeout>()

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const rel = vaultNoteRel(e.document)
      if (rel === null || e.contentChanges.length === 0) return
      const pending = timers.get(rel)
      if (pending) clearTimeout(pending)
      timers.set(
        rel,
        setTimeout(() => {
          timers.delete(rel)
          if (e.document.isClosed) return
          vaultIndex.updateFromContent(rel, e.document.getText())
        }, DEBOUNCE_MS)
      )
    }),

    vscode.workspace.onDidSaveTextDocument((doc) => {
      const rel = vaultNoteRel(doc)
      if (rel === null) return
      markKnownContent(toAbs(rel), doc.getText())
      // Flush any pending debounce with the final saved text
      const pending = timers.get(rel)
      if (pending) {
        clearTimeout(pending)
        timers.delete(rel)
      }
      vaultIndex.updateFromContent(rel, doc.getText())
    }),

    vscode.workspace.onDidCloseTextDocument((doc) => {
      const rel = vaultNoteRel(doc)
      if (rel === null) return
      const pending = timers.get(rel)
      if (pending) {
        clearTimeout(pending)
        timers.delete(rel)
      }
      // The buffer is gone — disk is the truth again (drops unsaved edits
      // from the index, matching what the user just chose to discard).
      void vaultIndex.indexFile(rel)
    }),

    { dispose: () => timers.forEach((t) => clearTimeout(t)) }
  )
}
