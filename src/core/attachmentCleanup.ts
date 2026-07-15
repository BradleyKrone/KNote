import type { VaultPath } from '@shared/types'
import { isImage, isInside, parentOf, resolveEmbedPath, samePath } from '@shared/pathUtils'
import { parseNote } from '@shared/parser/parseNote'
import { getVaultConfig } from './vaultConfig'
import * as vaultIndex from './indexer/vaultIndex'
import * as vault from './vaultService'

/**
 * Vault-relative attachment cleanup: when a note stops referencing an image
 * inside the configured attachments folder (edited out, or the note itself
 * deleted), the file is trashed — but only once no other note still embeds
 * it, so shared images are never touched.
 */

const MD_IMAGE_RE = /!\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)\s*\)/g

/** All vault-relative image paths a note's content refers to (wiki-embeds + standard markdown images). */
function collectImageRefs(content: string, notePath: VaultPath): string[] {
  const baseFolder = parentOf(notePath)
  const refs: string[] = []

  for (const link of parseNote(notePath, content).links) {
    if (!link.embed || !isImage(link.target)) continue
    const resolved = resolveEmbedPath(baseFolder, link.target)
    if (resolved) refs.push(resolved)
  }

  MD_IMAGE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MD_IMAGE_RE.exec(content)) !== null) {
    let url = m[1]
    if (url.startsWith('<')) url = url.slice(1, -1)
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) continue // non-local scheme
    if (!isImage(url)) continue
    const resolved = resolveEmbedPath(baseFolder, url)
    if (resolved) refs.push(resolved)
  }

  return refs
}

function includesPath(list: string[], target: VaultPath): boolean {
  return list.some((r) => samePath(r, target))
}

function isReferencedElsewhere(attachmentRel: VaultPath, exceptNotePath: VaultPath): boolean {
  for (const [notePath, content] of vaultIndex.getAllContents()) {
    if (samePath(notePath, exceptNotePath)) continue
    if (includesPath(collectImageRefs(content, notePath), attachmentRel)) return true
  }
  return false
}

async function trashIfOrphaned(
  rel: VaultPath,
  attachmentsFolder: string,
  exceptNotePath: VaultPath
): Promise<void> {
  if (!isInside(rel, attachmentsFolder)) return
  if (isReferencedElsewhere(rel, exceptNotePath)) return
  try {
    await vault.deleteEntry(rel)
  } catch {
    // already gone, or otherwise untrashable — nothing to clean up
  }
}

/** Trash any attachment `notePath` stopped referencing between its old and new content. */
export async function cleanupRemovedAttachments(
  notePath: VaultPath,
  oldContent: string | undefined,
  newContent: string
): Promise<void> {
  if (!oldContent) return
  const oldRefs = collectImageRefs(oldContent, notePath)
  if (oldRefs.length === 0) return
  const newRefs = collectImageRefs(newContent, notePath)
  const removed = oldRefs.filter((r) => !includesPath(newRefs, r))
  if (removed.length === 0) return

  const config = await getVaultConfig()
  for (const rel of removed) {
    await trashIfOrphaned(rel, config.attachmentsFolder, notePath)
  }
}

/** Trash attachments a just-deleted note referenced, if nothing else still uses them. */
export async function cleanupAttachmentsForDeletedNote(
  notePath: VaultPath,
  content: string
): Promise<void> {
  const refs = collectImageRefs(content, notePath)
  if (refs.length === 0) return

  const config = await getVaultConfig()
  for (const rel of refs) {
    await trashIfOrphaned(rel, config.attachmentsFolder, notePath)
  }
}
