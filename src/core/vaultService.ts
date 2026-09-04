// The filesystem layer: vault root state, path safety (toAbs), and all
// note/folder CRUD. Writes go through writeFileAtomic and coordinate with
// the watcher via the own-write / known-content markers below.
//
// This module must stay free of Electron/VS Code imports so it runs under
// vitest and bundles anywhere; host-specific behavior (trash) is injected.

import { promises as fs } from 'fs'
import { dirname, relative, resolve, sep } from 'path'
import { parse as parseYaml, stringify as yamlStringify } from 'yaml'
import type {
  FileEntry,
  FileReadResult,
  FileWriteResult,
  VaultInfo,
  VaultPath
} from '@shared/types'
import { isMarkdown, joinRel, nameOf, normalizeRel, parentOf } from '@shared/pathUtils'
import { getVaultConfig } from './vaultConfig'
import type { VaultMount } from './mounts'
import { CONFLICT_ERROR } from '@shared/errors'

let vaultRoot: string | null = null

/**
 * Extra folders grafted onto the vault as virtual top-level folders (see
 * `core/mounts.ts`). A mount's name is the first segment of every VaultPath
 * inside it, which is what lets the whole app above this module keep treating
 * paths as plain root-relative strings.
 */
let mounts: readonly VaultMount[] = []

/**
 * Called around every write KNote itself makes, so the watcher can tell
 * echo events apart from external edits. When content is provided the
 * watcher compares hashes; otherwise it falls back to a short TTL.
 */
let ownWriteMarker: (absPath: string, content?: string) => void = () => {}

export function setOwnWriteMarker(fn: (absPath: string, content?: string) => void): void {
  ownWriteMarker = fn
}

/**
 * Called after every read, so the watcher has a baseline hash for the file
 * even before KNote has written to it. Without this, a sync client (e.g.
 * OneDrive) rewriting the file with identical bytes sometime after it was
 * opened — but before any KNote save — would be misread as an external edit.
 */
let knownContentMarker: (absPath: string, content: string) => void = () => {}

export function setKnownContentMarker(fn: (absPath: string, content: string) => void): void {
  knownContentMarker = fn
}

/**
 * Moves a file/folder to the OS trash. Injected by the host (the VS Code
 * extension uses workspace.fs.delete with useTrash) so this module stays
 * host-agnostic. Deliberately throws when unset — silently hard-deleting
 * notes would be worse than failing.
 */
let trashHandler: (absPath: string) => Promise<void> = async () => {
  throw new Error('No trash handler installed (setTrashHandler was never called)')
}

export function setTrashHandler(fn: (absPath: string) => Promise<void>): void {
  trashHandler = fn
}

export function setVault(root: string): VaultInfo {
  vaultRoot = resolve(root)
  mounts = []
  return currentVault()!
}

/**
 * Register the mounted folders. Separate from `setVault` because planning them
 * needs `getVaultConfig()`, which can only be read once the root is set.
 */
export function setMounts(next: readonly VaultMount[]): void {
  mounts = next.map((m) => ({ name: m.name, root: resolve(m.root) }))
}

export function getMounts(): readonly VaultMount[] {
  return mounts
}

/** Every folder the vault spans: the primary root first, then each mount. */
export function getVaultRoots(): string[] {
  if (!vaultRoot) return []
  return [vaultRoot, ...mounts.map((m) => m.root)]
}

/** The mount a path lives in, or null when it's in the primary root. */
function mountFor(norm: string): VaultMount | null {
  const first = norm.split('/')[0]?.toLowerCase()
  if (!first) return null
  return mounts.find((m) => m.name.toLowerCase() === first) ?? null
}

/** The mount a vault path belongs to, or null when it lives in the primary root. */
export function mountNameOf(rel: VaultPath): string | null {
  return mountFor(normalizeRel(rel))?.name ?? null
}

/** True when `rel` is a mount's own top-level folder (never deletable/movable). */
export function isMountRoot(rel: VaultPath): boolean {
  const norm = normalizeRel(rel)
  if (norm === '' || norm.includes('/')) return false
  return mounts.some((m) => m.name.toLowerCase() === norm.toLowerCase())
}

function currentVault(): VaultInfo | null {
  if (!vaultRoot) return null
  const parts = vaultRoot.split(sep).filter(Boolean)
  return { root: vaultRoot, name: parts[parts.length - 1] ?? vaultRoot }
}

export function getVaultRoot(): string {
  if (!vaultRoot) throw new Error('No vault is open')
  return vaultRoot
}

/**
 * Resolve a vault-relative path to absolute, refusing anything that escapes the
 * vault. When the first segment names a mount the path resolves inside that
 * mount's own root instead of the primary one — this single redirect is what
 * makes every write path (atomic writes, mkdir, uniquify, trash) mount-aware,
 * since they all funnel through here.
 */
export function toAbs(rel: VaultPath): string {
  const primary = getVaultRoot()
  const norm = normalizeRel(rel)
  if (norm.split('/').includes('..')) throw new Error(`Invalid path: ${rel}`)
  const mount = mountFor(norm)
  const root = mount ? mount.root : primary
  const within = mount ? norm.slice(mount.name.length + 1) : norm
  const abs = resolve(root, within)
  if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`Path escapes vault: ${rel}`)
  return abs
}

/**
 * The inverse of `toAbs`: the vault path for an absolute path, or null when it
 * lies outside every root. `''` is the primary root itself and a bare mount
 * name is that mount's root — deliberately not `''`, so callers can tell the
 * two apart. Never throws (the watcher calls it after the vault has closed).
 */
export function relForAbs(abs: string): VaultPath | null {
  if (!vaultRoot) return null
  const target = resolve(abs)
  let best: string | null = null
  for (const { name, root } of [{ name: '', root: vaultRoot }, ...mounts]) {
    const rel = relative(root, target)
    if (rel.startsWith('..') || rel.includes('..' + sep)) continue
    const full = joinRel(name, normalizeRel(rel))
    // Roots never nest (planMounts rejects overlaps), so at most one matches;
    // the shortest is still the right answer if that ever changes.
    if (best === null || full.length < best.length) best = full
  }
  return best
}

const IGNORED_DIRS = new Set(['.knote', '.git', '.obsidian', 'node_modules'])

export function isIgnoredRel(rel: string): boolean {
  return normalizeRel(rel)
    .split('/')
    .some((seg) => IGNORED_DIRS.has(seg) || (seg.startsWith('.') && seg !== ''))
}

/**
 * A vault holds whatever the user puts in it — notes, images, PDFs, draw.io
 * diagrams — and the file tree shows all of it. The only thing hidden is
 * KNote's own atomic-write scratch file, which would otherwise flicker into
 * the tree for the moment between writing and renaming it over the target.
 * (Dotfiles are filtered separately, at the point of the directory read.)
 */
function isVisibleFile(name: string): boolean {
  return !name.endsWith('.knote-tmp')
}

/**
 * One level of a vault folder — `''` is the root. Folders come back without
 * `children`, so a caller walking a big vault only pays for the folders it
 * actually opens.
 */
export async function readDir(rel: VaultPath): Promise<FileEntry[]> {
  const relDir = normalizeRel(rel)
  const absDir = toAbs(relDir)
  const config = await getVaultConfig()

  let dirents
  try {
    dirents = await fs.readdir(absDir, { withFileTypes: true })
  } catch {
    return []
  }
  const folders: FileEntry[] = []
  const files: FileEntry[] = []
  for (const d of dirents) {
    const path = joinRel(relDir, d.name)
    if (d.isDirectory()) {
      if (IGNORED_DIRS.has(d.name) || d.name.startsWith('.')) continue
      // A real folder that has since been created under a mount's name would
      // show twice and be unreachable anyway (toAbs routes past it to the
      // mount), so the mount wins and the shadowed folder is hidden.
      if (relDir === '' && mounts.some((m) => m.name.toLowerCase() === d.name.toLowerCase())) {
        continue
      }
      folders.push({ path, name: d.name, kind: 'folder' })
    } else if (d.isFile()) {
      if (d.name.startsWith('.') || !isVisibleFile(d.name)) continue
      files.push({ path, name: d.name, kind: 'file' })
    }
  }
  // Mounted folders are part of the root listing, merged in before the sort so
  // they land in alphabetical order like any other folder.
  if (relDir === '') {
    for (const m of mounts) folders.push({ path: m.name, name: m.name, kind: 'folder' })
  }

  // numeric: true makes embedded numbers compare by value (so "9" sorts
  // before "12"), which is what keeps date-stamped file names like weekly
  // notes in chronological order instead of plain lexicographic order.
  const byName = (a: FileEntry, b: FileEntry): number =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  folders.sort(byName)
  // The weekly notes folder reads newest-first; every other folder stays A-Z.
  files.sort(relDir === normalizeRel(config.weeklyFolder) ? (a, b) => byName(b, a) : byName)
  return [...folders, ...files]
}

/** The whole vault as one nested tree — `readDir` applied recursively. */
export async function buildTree(): Promise<FileEntry[]> {
  async function walk(relDir: VaultPath): Promise<FileEntry[]> {
    const entries = await readDir(relDir)
    return Promise.all(
      entries.map(async (entry) =>
        entry.kind === 'folder' ? { ...entry, children: await walk(entry.path) } : entry
      )
    )
  }

  return walk('')
}

export async function readFile(rel: VaultPath): Promise<FileReadResult> {
  const abs = toAbs(rel)
  const [content, stat] = await Promise.all([fs.readFile(abs, 'utf-8'), fs.stat(abs)])
  knownContentMarker(abs, content)
  return { path: normalizeRel(rel), content, mtimeMs: stat.mtimeMs }
}

let tmpCounter = 0

/**
 * Atomic write: write to a temp file in the same directory, then rename over
 * the target. Rename can transiently fail on Windows (AV/sync tools holding
 * the file) so retry briefly.
 *
 * If expectedMtimeMs is provided and the file on disk was modified since
 * then, the write is refused (optimistic concurrency) — the caller decides
 * how to reconcile rather than silently clobbering an external edit.
 */
export async function writeFileAtomic(
  rel: VaultPath,
  content: string,
  expectedMtimeMs?: number
): Promise<FileWriteResult> {
  const abs = toAbs(rel)
  if (expectedMtimeMs !== undefined) {
    try {
      const current = await fs.stat(abs)
      if (Math.abs(current.mtimeMs - expectedMtimeMs) > 1) {
        throw new Error(`${CONFLICT_ERROR}: ${rel} changed on disk since it was loaded`)
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith(CONFLICT_ERROR)) throw err
      // File missing is fine — the write recreates it
    }
  }
  // Unique per write so concurrent writes to the same file can't clobber
  // each other's temp file. Must keep the `.knote-tmp` suffix — the watcher
  // ignores paths by that ending.
  const tmp = `${abs}.${process.pid}-${tmpCounter++}.knote-tmp`
  await fs.writeFile(tmp, content, 'utf-8')
  let lastErr: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      ownWriteMarker(abs, content)
      await fs.rename(tmp, abs)
      const stat = await fs.stat(abs)
      return { mtimeMs: stat.mtimeMs }
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)))
    }
  }
  await fs.rm(tmp, { force: true }).catch(() => {})
  throw lastErr
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs)
    return true
  } catch {
    return false
  }
}

/** "Note.md" -> "Note 1.md" -> "Note 2.md" until free. */
async function uniquify(rel: VaultPath): Promise<VaultPath> {
  let candidate = normalizeRel(rel)
  if (!(await exists(toAbs(candidate)))) return candidate
  const parent = parentOf(candidate)
  const name = nameOf(candidate)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 1; ; i++) {
    candidate = joinRel(parent, `${stem} ${i}${ext}`)
    if (!(await exists(toAbs(candidate)))) return candidate
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * Stamp a `created` timestamp into a new note's frontmatter so every note
 * carries a stable creation date that survives sync tools resetting file
 * mtimes. Never overwrites an existing `created` value (e.g. from a
 * template that already set one).
 */
export function stampCreatedFrontmatter(content: string): string {
  const now = new Date().toISOString()
  const m = content.match(FRONTMATTER_RE)
  if (!m) return `---\ncreated: ${now}\n---\n${content}`
  let fm: unknown
  try {
    fm = parseYaml(m[1])
  } catch {
    return content
  }
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) return content
  if ('created' in (fm as Record<string, unknown>)) return content
  const merged = { created: now, ...(fm as Record<string, unknown>) }
  return `---\n${yamlStringify(merged).trimEnd()}\n---\n${content.slice(m[0].length)}`
}

export async function createFile(
  rel: VaultPath,
  content = '',
  opts?: { skipCreatedStamp?: boolean }
): Promise<VaultPath> {
  const target = await uniquify(rel)
  const abs = toAbs(target)
  const finalContent =
    isMarkdown(target) && !opts?.skipCreatedStamp ? stampCreatedFrontmatter(content) : content
  await fs.mkdir(dirname(abs), { recursive: true })
  ownWriteMarker(abs, finalContent)
  await fs.writeFile(abs, finalContent, { encoding: 'utf-8', flag: 'wx' })
  return target
}

export async function createBinaryFile(rel: VaultPath, data: Buffer): Promise<VaultPath> {
  const target = await uniquify(rel)
  const abs = toAbs(target)
  await fs.mkdir(dirname(abs), { recursive: true })
  ownWriteMarker(abs)
  await fs.writeFile(abs, data, { flag: 'wx' })
  return target
}

const DEFAULT_TEMPLATE_NOTE = `# {{title}}

Created: {{date}}

## Tasks

## Notes

{{weekdays}}
`

/**
 * New/empty vaults have no Templates folder yet — seed one with a starter
 * note so "Insert template" has something to show. No-ops if the folder
 * already exists, so this never clobbers a vault the user has customized.
 * Returns the seeded note's path, or null if nothing was created.
 */
export async function ensureDefaultTemplate(templatesFolder: string): Promise<VaultPath | null> {
  if (await exists(toAbs(templatesFolder))) return null
  await fs.mkdir(toAbs(templatesFolder), { recursive: true })
  return createFile(joinRel(templatesFolder, 'Note Template.md'), DEFAULT_TEMPLATE_NOTE, {
    skipCreatedStamp: true
  })
}

export async function createFolder(rel: VaultPath): Promise<VaultPath> {
  const target = await uniquify(rel)
  const abs = toAbs(target)
  ownWriteMarker(abs)
  await fs.mkdir(abs, { recursive: true })
  return target
}

/**
 * A mounted folder belongs to the workspace, not to the vault — deleting or
 * moving it would take the whole external folder with it. KNote refuses at
 * every layer; the way to remove one is to take it out of the workspace.
 */
function refuseMountRoot(rel: VaultPath, verb: string): void {
  if (isMountRoot(rel)) {
    throw new Error(
      `Cannot ${verb} "${rel}" — it is a folder mounted from outside the vault. ` +
        `Remove it from the workspace instead.`
    )
  }
}

export async function deleteEntry(rel: VaultPath): Promise<void> {
  refuseMountRoot(rel, 'delete')
  const abs = toAbs(rel)
  ownWriteMarker(abs)
  await trashHandler(abs)
}

/**
 * Hard-deletes a file/folder, bypassing the OS trash entirely. Only meant
 * as a fallback when trashHandler has already failed (e.g. a OneDrive/
 * network-backed path the OS recycle-bin API rejects) — the caller is
 * responsible for confirming with the user first, since this is unrecoverable.
 */
export async function deleteEntryPermanently(rel: VaultPath): Promise<void> {
  refuseMountRoot(rel, 'delete')
  const abs = toAbs(rel)
  ownWriteMarker(abs)
  await fs.rm(abs, { recursive: true, force: true })
}
