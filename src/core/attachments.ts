// Shared "save clipboard image bytes into the vault's attachments folder"
// logic, used by both entry points that can receive a pasted image: the
// DocumentPasteEditProvider (native text editor, extension/providers/pasteImage.ts)
// and the live-preview webview's own paste handler (routed through the host
// RPC channel, rpc/hostHandlers.ts). vscode-free so it's directly unit-testable.

import dayjs from 'dayjs'
import type { VaultPath } from '@shared/types'
import { joinRel } from '@shared/pathUtils'
import { getVaultConfig } from './vaultConfig'
import * as vault from './vaultService'

export const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg'
}

/** Save pasted image bytes into the vault's configured attachments folder. */
export async function saveImageAttachment(mime: string, bytes: Buffer): Promise<VaultPath> {
  const config = await getVaultConfig()
  const ext = EXT_BY_MIME[mime] ?? 'png'
  const fileName = `Pasted image ${dayjs().format('YYYYMMDDHHmmss')}.${ext}`
  return vault.createBinaryFile(joinRel(config.attachmentsFolder, fileName), bytes)
}

/**
 * Create a blank draw.io diagram (the .drawio.svg "editable image" format) in
 * the vault's configured attachments folder. Written empty — same as the
 * Draw.io Integration extension's own "New Diagram" command writes for a
 * fresh .drawio file — its editor treats an empty document as a blank canvas.
 */
export async function createDrawioDiagram(): Promise<VaultPath> {
  const config = await getVaultConfig()
  // Millisecond precision: unlike saveImageAttachment's single .ext, a
  // same-second collision here would get uniquified as "….drawio 1.svg"
  // (vaultService's uniquify only splits on the last dot) instead of
  // "…-1.drawio.svg", which would stop isDrawioFile from recognizing it.
  const fileName = `Diagram ${dayjs().format('YYYYMMDDHHmmssSSS')}.drawio.svg`
  return vault.createBinaryFile(joinRel(config.attachmentsFolder, fileName), Buffer.alloc(0))
}
