import { promises as fs } from 'fs'
import type { VaultPath } from '@shared/types'
import {
  isImage,
  isInside,
  normalizeRel,
  parentOf,
  resolveEmbedPath,
  samePath
} from '@shared/pathUtils'
import { parseNote } from '@shared/parser/parseNote'
import { allAttachmentFolders } from './attachments'
import * as vaultIndex from './indexer/vaultIndex'
import * as vault from './vaultService'

/**
 * Vault-relative attachment cleanup: when nothing references an image inside
 * the configured attachments folder anymore, the file is trashed — but only
 * once no *other* note still embeds it, so shared images are never touched.
 *
 * Cleanup is driven by a list of **candidate refs** rather than by diffing two
 * versions of a note's text. The caller decides what counts as a candidate:
 * the editor half (extension/attachmentAutoCleanup) tracks every ref a buffer
 * has held since its last save — so an image pasted and then undone before any
 * save is still a candidate — while the watcher half (extension/engine) passes
 * the refs of the note's previously indexed content.
 */

const MD_IMAGE_RE = /!\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)\s*\)/g

/** What a cleanup pass actually did, so the host can log it instead of failing silently. */
export interface CleanupResult {
  trashed: VaultPath[]
  failed: { path: VaultPath; error: string }[]
}

const EMPTY_RESULT: CleanupResult = { trashed: [], failed: [] }

/** All vault-relative image paths a note's content refers to (wiki-embeds + standard markdown images). */
export function imageRefsOf(content: string, notePath: VaultPath): VaultPath[] {
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

function includesPath(list: readonly string[], target: VaultPath): boolean {
  return list.some((r) => samePath(r, target))
}

/** Case-insensitive key for set membership, matching `samePath`'s comparison. */
function pathKey(rel: string): string {
  return normalizeRel(rel).toLowerCase()
}

/**
 * Full-vault orphan scan: every image file inside the attachments folder
 * that no note references anymore. Read-only — the caller decides what to
 * trash (the "Clean Up Attachments" command confirms with the user first).
 */
export async function findOrphanedAttachments(): Promise<VaultPath[]> {
  const folders = await allAttachmentFolders()

  const referenced: string[] = []
  for (const [notePath, content] of vaultIndex.getAllContents()) {
    referenced.push(...imageRefsOf(content, notePath))
  }

  const orphans: VaultPath[] = []
  async function walk(relDir: string): Promise<void> {
    let dirents
    try {
      dirents = await fs.readdir(vault.toAbs(relDir), { withFileTypes: true })
    } catch {
      return
    }
    for (const d of dirents) {
      const rel = relDir === '' ? d.name : `${relDir}/${d.name}`
      if (d.isDirectory()) await walk(rel)
      else if (d.isFile() && isImage(d.name) && !includesPath(referenced, rel)) orphans.push(rel)
    }
  }
  for (const folder of folders) {
    if (normalizeRel(folder) === '') continue
    await walk(folder)
  }
  return orphans
}

/**
 * Every image ref held by a note other than `exceptNotePath`, as one pass over
 * the index. Built once per cleanup rather than per candidate — the old
 * per-candidate scan reparsed the whole vault for each removed image.
 */
function refsFromOtherNotes(exceptNotePath: VaultPath): Set<string> {
  const keys = new Set<string>()
  for (const [notePath, content] of vaultIndex.getAllContents()) {
    if (samePath(notePath, exceptNotePath)) continue
    for (const ref of imageRefsOf(content, notePath)) keys.add(pathKey(ref))
  }
  return keys
}

/**
 * Trash whichever candidates are inside the attachments folder and unreferenced
 * vault-wide. Candidates are deduped first: a note embedding the same image
 * twice would otherwise trash it, then fail trashing the file it just removed.
 */
async function trashOrphans(
  candidates: readonly string[],
  attachmentFolders: readonly string[],
  exceptNotePath: VaultPath
): Promise<CleanupResult> {
  // `isInside(rel, '')` is true for everything, so an attachments folder
  // configured as the vault root would make every removed image ref a deletion
  // candidate — across mounted folders too. Refuse rather than sweep a repo.
  const folders = attachmentFolders.filter((f) => normalizeRel(f) !== '')
  if (folders.length === 0) return EMPTY_RESULT

  const inFolder = new Map<string, VaultPath>()
  for (const rel of candidates) {
    const key = pathKey(rel)
    if (!inFolder.has(key) && folders.some((f) => isInside(rel, f))) {
      inFolder.set(key, normalizeRel(rel))
    }
  }
  if (inFolder.size === 0) return EMPTY_RESULT

  const stillUsed = refsFromOtherNotes(exceptNotePath)
  const result: CleanupResult = { trashed: [], failed: [] }
  for (const [key, rel] of inFolder) {
    if (stillUsed.has(key)) continue
    try {
      await vault.deleteEntry(rel)
      result.trashed.push(rel)
    } catch (err) {
      result.failed.push({ path: rel, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}

/**
 * Trash any candidate attachment that `newContent` no longer references.
 * The primary entry point — see the module comment on where candidates come from.
 */
export async function cleanupUnreferenced(
  notePath: VaultPath,
  candidateRefs: readonly string[],
  newContent: string
): Promise<CleanupResult> {
  if (candidateRefs.length === 0) return EMPTY_RESULT
  const newRefs = imageRefsOf(newContent, notePath)
  const removed = candidateRefs.filter((r) => !includesPath(newRefs, r))
  if (removed.length === 0) return EMPTY_RESULT

  return trashOrphans(removed, await allAttachmentFolders(), notePath)
}

/** Trash any attachment `notePath` stopped referencing between its old and new content. */
export async function cleanupRemovedAttachments(
  notePath: VaultPath,
  oldContent: string | undefined,
  newContent: string
): Promise<CleanupResult> {
  if (!oldContent) return EMPTY_RESULT
  return cleanupUnreferenced(notePath, imageRefsOf(oldContent, notePath), newContent)
}

/** Trash attachments a just-deleted note referenced, if nothing else still uses them. */
export async function cleanupAttachmentsForDeletedNote(
  notePath: VaultPath,
  content: string
): Promise<CleanupResult> {
  const refs = imageRefsOf(content, notePath)
  if (refs.length === 0) return EMPTY_RESULT

  return trashOrphans(refs, await allAttachmentFolders(), notePath)
}
