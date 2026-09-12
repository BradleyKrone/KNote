// Wires the core engine (vault service, watcher, index, search) into the
// extension host, and fans index deltas out to whoever subscribes
// (webviews, decorations, tree views).

import * as vscode from 'vscode'
import type { IndexDelta, NoteMeta, VaultPath } from '@shared/types'
import { isImage, isInside, isMarkdown } from '@shared/pathUtils'
import * as vault from '../core/vaultService'
import * as vaultIndex from '../core/indexer/vaultIndex'
import {
  cleanupAttachmentsForDeletedNote,
  cleanupRemovedAttachments,
  findOrphanedAttachments,
  type CleanupResult
} from '../core/attachmentCleanup'
import { getVaultConfig, setVaultConfig } from '../core/vaultConfig'
import { planMounts } from '../core/mounts'
import type { VaultLayout } from './vault'
import { markKnownContent, markOwnWrite, startWatching, stopWatching } from '../core/watcher'

const deltaEmitter = new vscode.EventEmitter<IndexDelta>()
/** Fires whenever a note's parsed metadata changes (any source: edits, watcher, board writes). */
export const onIndexDelta = deltaEmitter.event

const attachmentChangeEmitter = new vscode.EventEmitter<VaultPath>()
/**
 * Fires when an image/attachment file changes on disk from outside KNote's
 * own write paths — e.g. a draw.io diagram edited and saved in its own
 * editor. Editor saves of the note itself never come through here (that's
 * live CodeMirror sync); this is specifically for files KNote doesn't own
 * the writes to.
 */
export const onAttachmentChange = attachmentChangeEmitter.event

const fsChangeEmitter = new vscode.EventEmitter<void>()
/**
 * Fires on any watcher event at all — file or folder, markdown or not. The
 * Files tree shows the vault as it sits on disk, and index deltas only ever
 * cover markdown notes, so folders and attachments need their own signal.
 */
export const onVaultFsChange = fsChangeEmitter.event

let vaultRoot: string | null = null

// The activation log channel, kept module-level so anything in the host can
// report without threading it through every call. Null until a vault starts.
let logChannel: vscode.OutputChannel | null = null

/** Append a line to the KNote output channel (no-op before the engine starts). */
function logLine(message: string): void {
  logChannel?.appendLine(message)
}

/**
 * Report what an attachment cleanup pass did. Failures used to be swallowed
 * silently, which made an untrashable file (OneDrive/EPERM, a locked handle)
 * indistinguishable from cleanup deciding the file was still in use.
 */
export function logCleanup(rel: VaultPath, result: CleanupResult): void {
  if (result.trashed.length > 0) {
    logLine(`Attachment cleanup: trashed ${result.trashed.join(', ')} (orphaned by ${rel})`)
  }
  for (const f of result.failed) {
    logLine(`Attachment cleanup: could not trash ${f.path} — ${f.error}`)
  }
}

// Providers, the custom editor and the sidebar views are all registered before
// the engine starts, so a restored editor can ask for the index while it's
// still being built and would otherwise be handed an empty vault. Callers that
// need the whole index await this instead.
let indexBuilt: Promise<void>
let markIndexBuilt: () => void = () => {}
// Whether `indexBuilt` has ever settled — false only before the very first
// startEngine() call ever runs. `activate()` calls registerLiveEditor et al
// (synchronously) before it awaits its way down to startEngine(); VS Code is
// free to resolve a restored editor/board tab in that gap, and it needs
// `indexBuilt` to genuinely still be pending then — starting it as an
// already-resolved Promise.resolve() (as this used to) let that race slip
// straight through, reading an unset vault root and a default-Config
// fallback. See liveEditorProvider.ts / hostHandlers.getVaultConfig.
let hasStartedOnce = false

function beginIndexBuild(): void {
  indexBuilt = new Promise<void>((resolve) => {
    markIndexBuilt = resolve
  })
}
beginIndexBuild()

/** Resolves once the vault-wide index has finished building (immediately when no vault is open). */
export function whenIndexBuilt(): Promise<void> {
  return indexBuilt
}

/**
 * Call once activation has determined there is no vault to open at all (no
 * `.knote/` folder found). Releases anything already awaiting whenIndexBuilt()
 * with nothing to build — without this, a webview that hit the pre-startEngine
 * race above would wait forever in a workspace with no vault, since nothing
 * else ever resolves it. A no-op once a vault has actually started (later
 * startEngine() calls re-arm the wait themselves); harmless if called more
 * than once (e.g. every failed restart).
 */
export function noVaultToOpen(): void {
  if (hasStartedOnce) return
  hasStartedOnce = true
  markIndexBuilt()
}

export function currentVaultRoot(): string | null {
  return vaultRoot
}

/**
 * Every folder on disk the vault spans — the primary root plus each mounted
 * folder. Webviews need all of them as `localResourceRoots` or images inside a
 * mounted folder resolve to a URI the webview silently refuses to load.
 */
export function currentVaultRoots(): string[] {
  return vault.getVaultRoots()
}

/** Fresh Map view of the index for the shared wikiResolve selectors. */
export function notesMap(): Map<string, NoteMeta> {
  return new Map(vaultIndex.getSnapshot().map((m) => [m.path, m]))
}

export async function startEngine(layout: VaultLayout, log: vscode.OutputChannel): Promise<void> {
  logChannel = log
  // The very first call reuses the pending promise set up at module load —
  // recreating it here unconditionally would strand anything that started
  // awaiting that one during the gap before this function was ever reached.
  // A restart (workspace folder change) re-enters this after a previous
  // successful/failed run already settled it, and does need a fresh pending
  // promise so a webview resolving mid-restart waits for *this* cycle.
  if (hasStartedOnce) beginIndexBuild()
  // Whatever happens below, `indexBuilt` must settle: anything awaiting it
  // (getIndexSnapshot, and so every webview's hydrate) would hang forever on a
  // failed start otherwise — a worse failure than the empty index it guards.
  try {
    vault.setOwnWriteMarker(markOwnWrite)
    vault.setKnownContentMarker(markKnownContent)
    vault.setTrashHandler((abs) =>
      Promise.resolve(
        vscode.workspace.fs.delete(vscode.Uri.file(abs), { recursive: true, useTrash: true })
      )
    )

    const info = vault.setVault(layout.primary)
    vaultRoot = info.root

    // Seed a starter template into new vaults, mirroring the old openVault flow
    const config = await getVaultConfig()

    // Mounts must be registered before the watcher and the index start, since
    // both enumerate whatever roots the vault spans at that moment.
    const topLevel = (await vault.readDir('')).map((e) => e.name)
    const plan = planMounts(info.root, layout.candidates, topLevel, {
      excluded: config.excludedFolders,
      names: config.mountNames
    })
    vault.setMounts(plan.mounts)
    for (const m of plan.mounts) log.appendLine(`Mounted ${m.root} as "${m.name}/"`)
    for (const r of plan.rejected) log.appendLine(`Not mounted: ${r.path} — ${r.reason}`)
    for (const v of layout.otherVaults) {
      log.appendLine(
        `Note: ${v} also has a .knote/ folder. Its notes are mounted, but its ` +
          `config, weekly notes and templates are ignored — ${info.root} is the vault.`
      )
    }
    const seededTemplate = await vault.ensureDefaultTemplate(config.templatesFolder)
    if (seededTemplate && !config.weeklyTemplate) {
      config.weeklyTemplate = seededTemplate
      await setVaultConfig(config)
    }

    vaultIndex.onDelta((delta) => deltaEmitter.fire(delta))

    const started = Date.now()
    await startWatching(vault.getVaultRoots(), (change) => {
      void handleWatcherEvent(change.path, change.kind)
    })
    await vaultIndex.initIndex()
    log.appendLine(
      `Vault "${info.name}" (${info.root}) — indexed ${vaultIndex.getSnapshot().length} notes in ${Date.now() - started}ms`
    )

    // Breadcrumb only — never trash automatically here. The index has just been
    // built and a note that is momentarily missing from it would make its still
    // -embedded images look orphaned, which would cost the user real files.
    const orphans = await findOrphanedAttachments()
    if (orphans.length > 0) {
      log.appendLine(
        `${orphans.length} attachment${orphans.length === 1 ? '' : 's'} in ${config.attachmentsFolder} ` +
          `no note references — run "KNote: Clean Up Orphaned Attachments" to review and trash them.`
      )
    }
  } finally {
    hasStartedOnce = true
    markIndexBuilt()
  }
}

/**
 * Watcher events with attachment auto-cleanup layered on: the note's
 * last-indexed content is captured before the index reacts, so a change or
 * deletion that orphaned an attachment can trash it. Editor saves never come
 * through here (own-write/known-content suppression) — those are diffed by
 * attachmentAutoCleanup.ts instead, so nothing is cleaned twice.
 */
async function handleWatcherEvent(rel: VaultPath, kind: string): Promise<void> {
  fsChangeEmitter.fire()
  if (kind === 'change' && isMarkdown(rel)) {
    const oldContent = vaultIndex.getContent(rel)
    await vaultIndex.handleFsChange(rel, kind)
    const newContent = vaultIndex.getContent(rel)
    if (oldContent !== undefined && newContent !== undefined && newContent !== oldContent) {
      logCleanup(rel, await cleanupRemovedAttachments(rel, oldContent, newContent))
    }
  } else if (kind === 'unlink' && isMarkdown(rel)) {
    const oldContent = vaultIndex.getContent(rel)
    await vaultIndex.handleFsChange(rel, kind)
    if (oldContent !== undefined) {
      logCleanup(rel, await cleanupAttachmentsForDeletedNote(rel, oldContent))
    }
  } else if (kind === 'unlinkDir') {
    const deleted = [...vaultIndex.getAllContents()].filter(([path]) => isInside(path, rel))
    await vaultIndex.handleFsChange(rel, kind)
    for (const [path, content] of deleted) {
      logCleanup(path, await cleanupAttachmentsForDeletedNote(path, content))
    }
  } else {
    if ((kind === 'add' || kind === 'change') && isImage(rel)) {
      attachmentChangeEmitter.fire(rel)
    }
    await vaultIndex.handleFsChange(rel, kind)
  }
}

export async function stopEngine(): Promise<void> {
  vaultRoot = null
  vault.setMounts([])
  await stopWatching()
}
