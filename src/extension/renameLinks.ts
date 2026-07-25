// Keeps [[wiki links]] pointing at the right note when a note or folder is
// renamed or moved — Obsidian's "automatically update internal links".
//
// Hooks onWillRenameFiles and contributes a single WorkspaceEdit via
// waitUntil, deliberately instead of the writeFileAtomic path used by
// renameTagAcrossVault: a WorkspaceEdit lands in open buffers (unsaved edits
// included), saves closed files, and — because VS Code applies it as part of
// the same file operation — makes the whole rewrite share one undo step with
// the rename. Ctrl+Z puts the vault back exactly as it was.

import * as vscode from 'vscode'
import type { NoteMeta, VaultPath } from '@shared/types'
import { isInside, isMarkdown, joinRel, samePath } from '@shared/pathUtils'
import { planLinkRenames, type Rename } from '../core/linkRename'
import * as vaultIndex from '../core/indexer/vaultIndex'
import { getVaultConfig } from '../core/vaultConfig'
import { isIgnoredRel } from '../core/vaultService'
import { openDocFor, relForUri, uriForRel } from './paths'

/** Index snapshot as the resolution map link rewriting needs. */
function notesMap(): Map<string, NoteMeta> {
  return new Map(vaultIndex.getSnapshot().map((meta) => [meta.path, meta]))
}

/**
 * Expand one file-operation rename into the note renames it implies: a `.md`
 * file is itself; a folder is every indexed note under it, remapped onto the
 * new folder. Non-markdown files (attachments) and ignored paths contribute
 * nothing — no wiki link resolves to them.
 */
function expandRename(
  oldRel: VaultPath,
  newRel: VaultPath,
  notes: Map<string, NoteMeta>
): Rename[] {
  if (isMarkdown(oldRel)) {
    return isIgnoredRel(oldRel) ? [] : [{ oldPath: oldRel, newPath: newRel }]
  }
  const out: Rename[] = []
  for (const path of notes.keys()) {
    if (!isInside(path, oldRel) || samePath(path, oldRel)) continue
    const suffix = path.slice(oldRel.length).replace(/^\//, '')
    out.push({ oldPath: path, newPath: joinRel(newRel, suffix) })
  }
  return out
}

/**
 * Current text for every note, preferring an open editor buffer over the
 * index's copy — docSync only pushes into the index after a 250ms debounce, so
 * the index can lag a burst of typing and rewriting from it would clobber the
 * user's newest keystrokes.
 */
function currentContents(): Array<readonly [VaultPath, string]> {
  const out: Array<readonly [VaultPath, string]> = []
  for (const [path, indexed] of vaultIndex.getAllContents()) {
    const doc = openDocFor(path)
    out.push([path, doc ? doc.getText() : indexed])
  }
  return out
}

/** Whole-document range for text we already hold, so closed files can be replaced without opening them. */
function fullRange(content: string): vscode.Range {
  const lines = content.split('\n')
  const lastIdx = lines.length - 1
  return new vscode.Range(0, 0, lastIdx, lines[lastIdx].length)
}

async function planEdit(files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]) {
  const config = await getVaultConfig()
  if (config.linkUpdate === 'never') return undefined

  const notes = notesMap()
  const renames: Rename[] = []
  for (const { oldUri, newUri } of files) {
    const oldRel = relForUri(oldUri)
    const newRel = relForUri(newUri)
    if (oldRel === null || newRel === null) continue
    renames.push(...expandRename(oldRel, newRel, notes))
  }
  if (renames.length === 0) return undefined

  const original = currentContents()
  const changed = planLinkRenames(renames, original, notes)
  if (changed.size === 0) return undefined

  // Edits target the *old* uris: VS Code applies a waitUntil edit before
  // carrying out the rename, so a renamed note that itself needed rewriting is
  // edited in place and then moved.
  const before = new Map(original)
  const edit = new vscode.WorkspaceEdit()
  for (const [path, content] of changed) {
    edit.replace(uriForRel(path), fullRange(before.get(path) ?? ''), content)
  }

  // A WorkspaceEdit against a file that wasn't open leaves it as a dirty
  // in-memory buffer. That's fine for a code refactor, but a KNote vault's
  // source of truth is the files themselves — the index, board and any other
  // editor would disagree with disk until the user happened to save. So flag
  // for saving every note that was closed or clean, and only those: a buffer
  // the user already had unsaved edits in stays dirty, since persisting their
  // in-progress work is their call, not ours.
  const toSave: VaultPath[] = []
  for (const path of changed.keys()) {
    const doc = openDocFor(path)
    if (!doc || !doc.isDirty) toSave.push(path)
  }
  return { edit, toSave, renames, fileCount: changed.size }
}

/** Where each renamed note ended up, so a saved doc is found at its new location. */
function remap(renames: readonly Rename[], path: VaultPath): VaultPath {
  const hit = renames.find((r) => samePath(r.oldPath, path))
  return hit ? hit.newPath : path
}

export function registerRenameLinks(context: vscode.ExtensionContext): void {
  // Paths to persist once the rename itself has gone through — a participant
  // can't save during onWillRenameFiles, so the work is handed to the matching
  // onDidRenameFiles below.
  let pendingSaves: VaultPath[] = []

  context.subscriptions.push(
    vscode.workspace.onWillRenameFiles((event) => {
      event.waitUntil(
        (async () => {
          try {
            const planned = await planEdit(event.files)
            if (!planned) return new vscode.WorkspaceEdit()
            pendingSaves = planned.toSave.map((p) => remap(planned.renames, p))
            void vscode.window.setStatusBarMessage(
              `KNote: updated links in ${planned.fileCount} note${planned.fileCount === 1 ? '' : 's'}`,
              4000
            )
            return planned.edit
          } catch {
            // A failed link rewrite must never block the rename itself.
            pendingSaves = []
            return new vscode.WorkspaceEdit()
          }
        })()
      )
    }),

    vscode.workspace.onDidRenameFiles(() => {
      const paths = pendingSaves
      pendingSaves = []
      void (async () => {
        for (const path of paths) {
          const doc = openDocFor(path)
          if (doc?.isDirty) await doc.save()
        }
      })()
    })
  )
}
