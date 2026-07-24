// Wires the core engine (vault service, watcher, index, search) into the
// extension host, and fans index deltas out to whoever subscribes
// (webviews, decorations, tree views).

import * as vscode from 'vscode'
import type { IndexDelta, NoteMeta, VaultPath } from '@shared/types'
import { isInside, isMarkdown } from '@shared/pathUtils'
import * as vault from '../core/vaultService'
import * as vaultIndex from '../core/indexer/vaultIndex'
import {
  cleanupAttachmentsForDeletedNote,
  cleanupRemovedAttachments
} from '../core/attachmentCleanup'
import { getVaultConfig, setVaultConfig } from '../core/vaultConfig'
import { markKnownContent, markOwnWrite, startWatching, stopWatching } from '../core/watcher'

const deltaEmitter = new vscode.EventEmitter<IndexDelta>()
/** Fires whenever a note's parsed metadata changes (any source: edits, watcher, board writes). */
export const onIndexDelta = deltaEmitter.event

let vaultRoot: string | null = null

export function currentVaultRoot(): string | null {
  return vaultRoot
}

/** Fresh Map view of the index for the shared wikiResolve selectors. */
export function notesMap(): Map<string, NoteMeta> {
  return new Map(vaultIndex.getSnapshot().map((m) => [m.path, m]))
}

export async function startEngine(root: string, log: vscode.OutputChannel): Promise<void> {
  vault.setOwnWriteMarker(markOwnWrite)
  vault.setKnownContentMarker(markKnownContent)
  vault.setTrashHandler((abs) =>
    Promise.resolve(
      vscode.workspace.fs.delete(vscode.Uri.file(abs), { recursive: true, useTrash: true })
    )
  )

  const info = vault.setVault(root)
  vaultRoot = info.root

  // Seed a starter template into new vaults, mirroring the old openVault flow
  const config = await getVaultConfig()
  const seededTemplate = await vault.ensureDefaultTemplate(config.templatesFolder)
  if (seededTemplate && !config.weeklyTemplate) {
    config.weeklyTemplate = seededTemplate
    await setVaultConfig(config)
  }

  vaultIndex.onDelta((delta) => deltaEmitter.fire(delta))

  const started = Date.now()
  await startWatching(info.root, (change) => {
    void handleWatcherEvent(change.path, change.kind)
  })
  await vaultIndex.initIndex()
  log.appendLine(
    `Vault "${info.name}" (${info.root}) — indexed ${vaultIndex.getSnapshot().length} notes in ${Date.now() - started}ms`
  )
}

/**
 * Watcher events with attachment auto-cleanup layered on: the note's
 * last-indexed content is captured before the index reacts, so a change or
 * deletion that orphaned an attachment can trash it. Editor saves never come
 * through here (own-write/known-content suppression) — those are diffed by
 * attachmentAutoCleanup.ts instead, so nothing is cleaned twice.
 */
async function handleWatcherEvent(rel: VaultPath, kind: string): Promise<void> {
  if (kind === 'change' && isMarkdown(rel)) {
    const oldContent = vaultIndex.getContent(rel)
    await vaultIndex.handleFsChange(rel, kind)
    const newContent = vaultIndex.getContent(rel)
    if (oldContent !== undefined && newContent !== undefined && newContent !== oldContent) {
      await cleanupRemovedAttachments(rel, oldContent, newContent)
    }
  } else if (kind === 'unlink' && isMarkdown(rel)) {
    const oldContent = vaultIndex.getContent(rel)
    await vaultIndex.handleFsChange(rel, kind)
    if (oldContent !== undefined) await cleanupAttachmentsForDeletedNote(rel, oldContent)
  } else if (kind === 'unlinkDir') {
    const deleted = [...vaultIndex.getAllContents()].filter(([path]) => isInside(path, rel))
    await vaultIndex.handleFsChange(rel, kind)
    for (const [path, content] of deleted) {
      await cleanupAttachmentsForDeletedNote(path, content)
    }
  } else {
    await vaultIndex.handleFsChange(rel, kind)
  }
}

export async function stopEngine(): Promise<void> {
  vaultRoot = null
  await stopWatching()
}
