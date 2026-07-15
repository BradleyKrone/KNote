// Wires the core engine (vault service, watcher, index, search) into the
// extension host, and fans index deltas out to whoever subscribes
// (webviews, decorations, tree views).

import * as vscode from 'vscode'
import type { IndexDelta, NoteMeta } from '@shared/types'
import * as vault from '../core/vaultService'
import * as vaultIndex from '../core/indexer/vaultIndex'
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
    void vaultIndex.handleFsChange(change.path, change.kind)
  })
  await vaultIndex.initIndex()
  log.appendLine(
    `Vault "${info.name}" (${info.root}) — indexed ${vaultIndex.getSnapshot().length} notes in ${Date.now() - started}ms`
  )
}

export async function stopEngine(): Promise<void> {
  vaultRoot = null
  await stopWatching()
}
