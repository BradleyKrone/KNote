// Auto attachment cleanup, editor half: when a note stops referencing an image
// in the attachments folder, the image is moved to the OS trash (core/
// attachmentCleanup skips images other notes still embed).
//
// The rule is "every image ref this buffer has held since its last save is a
// cleanup candidate; a ref still present in the saved text — or, at close, in
// the text on disk — is never touched." So cutting an embed and pasting it back
// before saving is still a no-op, while an image pasted and then undone before
// any save is cleaned up: the file lands on disk at paste time, so a diff that
// only ever compared save to save could never see it and leaked it forever.
//
// Closing without saving runs the same check against the file on disk, after a
// settle delay that is cancelled if the note reopens (reopen-as-text, split).
// On window close the delay simply never fires — which is the right outcome,
// since VS Code's hot exit restores the unsaved buffer, embed and all.
//
// "Closed" means the *tab* went away, not onDidCloseTextDocument: VS Code
// releases a TextDocument lazily and can sit on it long after the editor is
// gone, so that event is far too late to act on. Tab closure fires at once and
// covers both the live-preview custom editor and the plain text editor.
//
// External (non-editor) changes and note deletions are handled by the watcher
// path in engine.ts; the manual "Clean Up Orphaned Attachments" command remains
// as a backstop for anything both paths miss.

import * as vscode from 'vscode'
import type { VaultPath } from '@shared/types'
import { cleanupUnreferenced, imageRefsOf } from '../core/attachmentCleanup'
import * as vaultIndex from '../core/indexer/vaultIndex'
import * as vault from '../core/vaultService'
import { logCleanup } from './engine'
import { tabNoteRel, vaultNoteRel } from './paths'

/** Idle pause before folding a buffer's full text into its seen-set (mirrors docSync). */
const CHANGE_SETTLE_MS = 250
/** Grace period after a close before cleaning against disk, so a reopen can cancel it. */
const CLOSE_SETTLE_MS = 1500

export function registerAttachmentAutoCleanup(context: vscode.ExtensionContext): void {
  /** Image refs each open note has held at any point since its last save. */
  const seen = new Map<VaultPath, Set<string>>()
  const idle = new Map<VaultPath, NodeJS.Timeout>()
  const closing = new Map<VaultPath, NodeJS.Timeout>()

  const union = (rel: VaultPath, refs: string[]): void => {
    if (refs.length === 0) return
    const set = seen.get(rel)
    if (set) refs.forEach((r) => set.add(r))
    else seen.set(rel, new Set(refs))
  }

  const clearTimer = (map: Map<VaultPath, NodeJS.Timeout>, rel: VaultPath): void => {
    const pending = map.get(rel)
    if (pending) {
      clearTimeout(pending)
      map.delete(rel)
    }
  }

  const seed = (doc: vscode.TextDocument): void => {
    const rel = vaultNoteRel(doc)
    if (rel === null) return
    // A close already scheduled for this note is stale now that it is open again.
    clearTimer(closing, rel)
    if (!seen.has(rel)) seen.set(rel, new Set(imageRefsOf(doc.getText(), rel)))
  }
  vscode.workspace.textDocuments.forEach(seed)

  /**
   * Push every other dirty vault buffer into the index before deciding what is
   * orphaned. Moving an embed between notes means the destination's ref lives
   * only in its buffer until docSync's own debounce catches up, and saving the
   * source inside that window would otherwise trash an image that is very much
   * still in use.
   */
  const flushDirtyBuffers = (except: VaultPath): void => {
    for (const doc of vscode.workspace.textDocuments) {
      if (!doc.isDirty || doc.isClosed) continue
      const rel = vaultNoteRel(doc)
      if (rel === null || rel === except) continue
      vaultIndex.updateFromContent(rel, doc.getText())
    }
  }

  /**
   * Check a note's candidates against the file on disk once the dust settles.
   * Deferred rather than immediate so a reopen can cancel it, and so a window
   * close tears the host down first — hot exit restores the unsaved buffer, so
   * trashing on shutdown would break an embed the user still has.
   */
  const scheduleCloseCleanup = (rel: VaultPath): void => {
    clearTimer(idle, rel)
    const candidates = [...(seen.get(rel) ?? [])]
    if (candidates.length === 0) {
      seen.delete(rel)
      return
    }
    // The seen-set stays put until the timer fires: a reopen inside the window
    // cancels the timer and must still know these candidates.
    clearTimer(closing, rel)
    closing.set(
      rel,
      setTimeout(() => {
        closing.delete(rel)
        seen.delete(rel)
        void (async () => {
          // A buffer still open (a split, or the doc outliving its tab) is the
          // truth, not disk — it may well still hold the embed.
          const open = vscode.workspace.textDocuments.find(
            (d) => !d.isClosed && vaultNoteRel(d) === rel
          )
          let content: string
          if (open) {
            content = open.getText()
          } else {
            try {
              content = (await vault.readFile(rel)).content
            } catch {
              // Gone from disk (deleted, or renamed out from under the editor)
              // — the watcher's unlink path owns that case.
              return
            }
          }
          flushDirtyBuffers(rel)
          logCleanup(rel, await cleanupUnreferenced(rel, candidates, content))
        })()
      }, CLOSE_SETTLE_MS)
    )
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(seed),

    vscode.workspace.onDidChangeTextDocument((e) => {
      const rel = vaultNoteRel(e.document)
      if (rel === null || e.contentChanges.length === 0) return

      // Fast path: parse just the inserted fragment. Every path that writes an
      // attachment to disk (paste in either editor, Insert Draw.io Diagram)
      // inserts its whole `![[…]]` embed in one change, so the candidate is
      // recorded the instant the file appears — no dependence on the debounce.
      for (const change of e.contentChanges) {
        if (change.text.includes('![')) union(rel, imageRefsOf(change.text, rel))
      }

      // Completeness net for refs that arrive some other way (hand-typed,
      // templates, board writes, edits coalesced across changes).
      clearTimer(idle, rel)
      idle.set(
        rel,
        setTimeout(() => {
          idle.delete(rel)
          if (e.document.isClosed) return
          const text = e.document.getText()
          // Every ref form imageRefsOf recognises contains this literal, so the
          // guard can skip the parse without ever dropping one.
          if (!text.includes('![')) return
          union(rel, imageRefsOf(text, rel))
        }, CHANGE_SETTLE_MS)
      )
    }),

    vscode.workspace.onDidSaveTextDocument((doc) => {
      const rel = vaultNoteRel(doc)
      if (rel === null) return
      clearTimer(idle, rel)
      const text = doc.getText()
      const candidates = [...(seen.get(rel) ?? [])]
      // Reset synchronously, before any await, so a second save landing while
      // the first is still running can't offer the same candidates again.
      seen.set(rel, new Set(imageRefsOf(text, rel)))
      if (candidates.length === 0) return
      flushDirtyBuffers(rel)
      void cleanupUnreferenced(rel, candidates, text).then((r) => logCleanup(rel, r))
    }),

    vscode.window.tabGroups.onDidChangeTabs((e) => {
      // A tab reappearing (reopen-as-text, moved to a split) cancels a pending
      // close pass before it can act on a note that is open again.
      for (const tab of [...e.opened, ...e.changed]) {
        const rel = tabNoteRel(tab)
        if (rel !== null) clearTimer(closing, rel)
      }
      for (const tab of e.closed) {
        const rel = tabNoteRel(tab)
        if (rel !== null) scheduleCloseCleanup(rel)
      }
    }),

    // Belt and braces: a document released without a tab of its own. Fires
    // long after the tab in practice, so the tab handler above is what
    // actually does the work.
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const rel = vaultNoteRel(doc)
      if (rel !== null) scheduleCloseCleanup(rel)
    }),

    {
      dispose: () => {
        idle.forEach((t) => clearTimeout(t))
        closing.forEach((t) => clearTimeout(t))
        idle.clear()
        closing.clear()
        seen.clear()
      }
    }
  )
}
