// Shared "save clipboard image bytes into the vault's attachments folder"
// logic, used by both entry points that can receive a pasted image: the
// DocumentPasteEditProvider (native text editor, extension/providers/pasteImage.ts)
// and the live-preview webview's own paste handler (routed through the host
// RPC channel, rpc/hostHandlers.ts). vscode-free so it's directly unit-testable.

import dayjs from 'dayjs'
import type { VaultPath } from '@shared/types'
import { joinRel, normalizeRel } from '@shared/pathUtils'
import { getVaultConfig } from './vaultConfig'
import * as vault from './vaultService'

/**
 * Where a note's attachments belong. Notes in a mounted folder keep their
 * images inside that same folder, so a note and the image it embeds stay
 * together — a screenshot pasted into a note in a git repo has to commit
 * alongside it, not land in the primary vault where the repo can't see it.
 */
export async function attachmentsFolderFor(noteRel: VaultPath | null): Promise<string> {
  const config = await getVaultConfig()
  const base = normalizeRel(config.attachmentsFolder)
  const mount = noteRel ? vault.mountNameOf(noteRel) : null
  return mount ? joinRel(mount, base) : base
}

/** Every attachments folder in the vault: the primary one plus one per mount. */
export async function allAttachmentFolders(): Promise<string[]> {
  const config = await getVaultConfig()
  const base = normalizeRel(config.attachmentsFolder)
  return [base, ...vault.getMounts().map((m) => joinRel(m.name, base))]
}

export const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg'
}

/** Save pasted image bytes into the attachments folder for the note being pasted into. */
export async function saveImageAttachment(
  mime: string,
  bytes: Buffer,
  noteRel: VaultPath | null
): Promise<VaultPath> {
  const folder = await attachmentsFolderFor(noteRel)
  const ext = EXT_BY_MIME[mime] ?? 'png'
  const fileName = `Pasted image ${dayjs().format('YYYYMMDDHHmmss')}.${ext}`
  return vault.createBinaryFile(joinRel(folder, fileName), bytes)
}

/**
 * Create a blank draw.io diagram (the .drawio.svg "editable image" format) in
 * the vault's configured attachments folder. Written empty — same as the
 * Draw.io Integration extension's own "New Diagram" command writes for a
 * fresh .drawio file — its editor treats an empty document as a blank canvas.
 */
export async function createDrawioDiagram(noteRel: VaultPath | null): Promise<VaultPath> {
  const folder = await attachmentsFolderFor(noteRel)
  // Millisecond precision: unlike saveImageAttachment's single .ext, a
  // same-second collision here would get uniquified as "….drawio 1.svg"
  // (vaultService's uniquify only splits on the last dot) instead of
  // "…-1.drawio.svg", which would stop isDrawioFile from recognizing it.
  const fileName = `Diagram ${dayjs().format('YYYYMMDDHHmmssSSS')}.drawio.svg`
  return vault.createBinaryFile(joinRel(folder, fileName), Buffer.alloc(0))
}
