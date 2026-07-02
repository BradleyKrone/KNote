import { promises as fs } from 'fs'
import { join } from 'path'
import pLimit from 'p-limit'
import type { IndexDelta, NoteMeta, VaultPath } from '@shared/types'
import { isInside, isMarkdown, joinRel, normalizeRel } from '@shared/pathUtils'
import { parseNote } from '@shared/parser/parseNote'
import { getVaultRoot, isIgnoredRel, toAbs } from '../vaultService'
import * as searchIndex from './searchIndex'

/**
 * In-memory vault index: one NoteMeta per markdown file plus a raw content
 * cache (for search snippets and mention scanning). Rebuilt on vault open,
 * patched incrementally afterwards. Never persisted — the .md files are the
 * only source of truth.
 */

const notes = new Map<string, NoteMeta>()
const contents = new Map<string, string>()

let deltaListener: (delta: IndexDelta) => void = () => {}

export function onDelta(fn: (delta: IndexDelta) => void): void {
  deltaListener = fn
}

export function getSnapshot(): NoteMeta[] {
  return [...notes.values()]
}

export function getNote(path: VaultPath): NoteMeta | undefined {
  return notes.get(normalizeRel(path))
}

export function getContent(path: VaultPath): string | undefined {
  return contents.get(normalizeRel(path))
}

export function getAllContents(): ReadonlyMap<string, string> {
  return contents
}

async function collectMarkdownFiles(relDir: string, out: string[]): Promise<void> {
  const abs = relDir === '' ? getVaultRoot() : toAbs(relDir)
  let dirents
  try {
    dirents = await fs.readdir(abs, { withFileTypes: true })
  } catch {
    return
  }
  for (const d of dirents) {
    const rel = joinRel(relDir, d.name)
    if (isIgnoredRel(rel)) continue
    if (d.isDirectory()) await collectMarkdownFiles(rel, out)
    else if (d.isFile() && isMarkdown(d.name)) out.push(rel)
  }
}

export async function initIndex(): Promise<void> {
  notes.clear()
  contents.clear()
  searchIndex.reset()
  const files: string[] = []
  await collectMarkdownFiles('', files)
  const limit = pLimit(8)
  await Promise.all(files.map((rel) => limit(() => indexFile(rel, false))))
}

/** (Re)index one markdown file from disk. */
export async function indexFile(rel: VaultPath, emit = true): Promise<void> {
  const key = normalizeRel(rel)
  if (!isMarkdown(key) || isIgnoredRel(key)) return
  try {
    const abs = toAbs(key)
    const [content, stat] = await Promise.all([fs.readFile(abs, 'utf-8'), fs.stat(abs)])
    const meta = parseNote(key, content, stat.mtimeMs)
    notes.set(key, meta)
    contents.set(key, content)
    searchIndex.update(meta, content)
    if (emit) deltaListener({ path: key, meta })
  } catch {
    removeFile(key, emit)
  }
}

export function removeFile(rel: VaultPath, emit = true): void {
  const key = normalizeRel(rel)
  if (!notes.has(key)) return
  notes.delete(key)
  contents.delete(key)
  searchIndex.remove(key)
  if (emit) deltaListener({ path: key, meta: null })
}

export function removeFolder(rel: VaultPath): void {
  for (const key of [...notes.keys()]) {
    if (isInside(key, rel)) removeFile(key)
  }
}

/** Reindex every markdown file under a folder (after a folder move/rename). */
export async function reindexFolder(rel: VaultPath): Promise<void> {
  const files: string[] = []
  await collectMarkdownFiles(normalizeRel(rel), files)
  const limit = pLimit(8)
  await Promise.all(files.map((f) => limit(() => indexFile(f))))
}

/** Full path/kind-aware reaction to a filesystem event. */
export async function handleFsChange(rel: VaultPath, kind: string): Promise<void> {
  if (kind === 'add' || kind === 'change') {
    if (isMarkdown(rel)) await indexFile(rel)
  } else if (kind === 'unlink') {
    removeFile(rel)
  } else if (kind === 'unlinkDir') {
    removeFolder(rel)
  } else if (kind === 'addDir') {
    await reindexFolder(rel)
  }
}

export async function moveIndexed(oldRel: VaultPath, newRel: VaultPath, isFolder: boolean): Promise<void> {
  if (isFolder) {
    removeFolder(oldRel)
    await reindexFolder(newRel)
  } else {
    removeFile(oldRel)
    await indexFile(newRel)
  }
}

async function statIsDir(rel: VaultPath): Promise<boolean> {
  try {
    return (await fs.stat(join(getVaultRoot(), normalizeRel(rel)))).isDirectory()
  } catch {
    return false
  }
}

export { statIsDir }
