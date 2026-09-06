// Vault maintenance commands: the bundled welcome/feature guide, the
// orphaned-attachment cleanup, and the one-shot `@task` conversion.

import * as vscode from 'vscode'
import { findOrphanedAttachments } from '../../core/attachmentCleanup'
import * as vaultIndex from '../../core/indexer/vaultIndex'
import * as vault from '../../core/vaultService'
import { legacyTaskLines } from '@shared/parser/legacyTasks'
import { anchorText } from '@shared/blockAnchor'
import { setTaskMarker } from '@shared/parser/patterns'
import type { VaultPath } from '@shared/types'
import { currentVaultRoot, whenIndexBuilt } from '../engine'
import * as verifiedEdit from '../verifiedEdit'

async function openWelcome(context: vscode.ExtensionContext): Promise<void> {
  const uri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'welcome.md')
  await vscode.commands.executeCommand('markdown.showPreview', uri)
}

async function cleanupAttachments(): Promise<void> {
  if (!currentVaultRoot()) {
    void vscode.window.showWarningMessage('KNote: no vault is open in this workspace.')
    return
  }
  const orphans = await findOrphanedAttachments()
  if (orphans.length === 0) {
    void vscode.window.showInformationMessage('KNote: no orphaned attachments found.')
    return
  }
  const picked = await vscode.window.showQuickPick(
    orphans.map((rel) => ({ label: rel, picked: true })),
    {
      canPickMany: true,
      placeHolder: `${orphans.length} attachment${orphans.length === 1 ? '' : 's'} no note references — select which to move to the trash`
    }
  )
  if (!picked || picked.length === 0) return
  for (const item of picked) {
    try {
      await vault.deleteEntry(item.label)
    } catch {
      // already gone, or untrashable — skip
    }
  }
  void vscode.window.showInformationMessage(
    `KNote: moved ${picked.length} orphaned attachment${picked.length === 1 ? '' : 's'} to the trash.`
  )
}

/** One checkbox line the conversion would mark, with the exact text to verify against. */
interface PendingMark {
  path: VaultPath
  line: number
  expected: string
  next: string
}

/** Every line in the vault that the old indentation rule made a card and the marker hasn't reached. */
function findLegacyTasks(): PendingMark[] {
  const out: PendingMark[] = []
  for (const [path, content] of vaultIndex.getAllContents()) {
    const lines = content.split(/\r?\n/)
    for (const line of legacyTaskLines(content)) {
      const expected = lines[line]
      const next = setTaskMarker(expected, true)
      if (next !== null && next !== expected) out.push({ path, line, expected, next })
    }
  }
  return out
}

const plural = (n: number, one: string, many = one + 's'): string => (n === 1 ? one : many)

/**
 * Convert a vault written before the `@task` marker: every checkbox that the
 * old rule made a Kanban card — a checkbox with no shallower checkbox above it —
 * gets the marker, so it stays one. Indented sub-checkboxes are left alone;
 * they were plain toggles before and still are.
 *
 * Safe to run twice: a line that already carries the marker is skipped, so a
 * second run finds nothing. Writes go through the ordinary verified-edit path,
 * batched per note, so a note that changed underneath is refused rather than
 * clobbered — and the whole conversion of one note is a single undo step.
 *
 * `confirm: false` skips the preview, for the integration harness.
 */
async function migrateLegacyTasks(options?: { confirm?: boolean }): Promise<void> {
  if (!currentVaultRoot()) {
    void vscode.window.showWarningMessage('KNote: no vault is open in this workspace.')
    return
  }
  // A cold start would otherwise convert whatever part of the vault happened to
  // be indexed by now.
  await whenIndexBuilt()

  let pending = findLegacyTasks()
  if (pending.length === 0) {
    void vscode.window.showInformationMessage(
      'KNote: no legacy tasks found — every board card already carries @task.'
    )
    return
  }

  if (options?.confirm !== false) {
    const noteCount = new Set(pending.map((m) => m.path)).size
    const picked = await vscode.window.showQuickPick(
      pending.map((m) => ({
        label: anchorText(m.next) || m.next.trim(),
        description: `${m.path}:${m.line + 1}`,
        picked: true,
        mark: m
      })),
      {
        canPickMany: true,
        placeHolder: `${pending.length} ${plural(pending.length, 'checkbox')} in ${noteCount} ${plural(noteCount, 'note')} will become @task tasks — deselect any to skip`
      }
    )
    if (!picked || picked.length === 0) return
    pending = picked.map((p) => p.mark)
  }

  const byNote = new Map<VaultPath, PendingMark[]>()
  for (const m of pending) {
    const list = byNote.get(m.path)
    if (list) list.push(m)
    else byNote.set(m.path, [m])
  }

  let converted = 0
  let notes = 0
  let skipped = 0
  for (const [path, marks] of byNote) {
    try {
      await verifiedEdit.replaceLines(
        path,
        marks.map((m) => ({ line: m.line, expected: m.expected, next: m.next }))
      )
      converted += marks.length
      notes++
    } catch {
      // Stale, or unwritable: leave it and say so — re-running picks it up.
      skipped++
    }
  }

  void vscode.window.showInformationMessage(
    `KNote: converted ${converted} ${plural(converted, 'task')} across ${notes} ${plural(notes, 'note')} to @task.` +
      (skipped > 0
        ? ` Skipped ${skipped} ${plural(skipped, 'note')} that changed during the conversion — run the command again.`
        : '')
  )
}

export function registerMaintenanceCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('knote.openWelcome', () => openWelcome(context)),
    vscode.commands.registerCommand('knote.cleanupAttachments', cleanupAttachments),
    vscode.commands.registerCommand('knote.migrateLegacyTasks', (options?: { confirm?: boolean }) =>
      migrateLegacyTasks(options)
    )
  )
}
