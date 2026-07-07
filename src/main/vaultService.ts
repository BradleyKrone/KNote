import { promises as fs } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import { shell } from 'electron'
import { parse as parseYaml, stringify as yamlStringify } from 'yaml'
import type { FileEntry, FileReadResult, FileWriteResult, VaultInfo, VaultPath } from '@shared/types'
import { isImage, isMarkdown, joinRel, nameOf, normalizeRel, parentOf } from '@shared/pathUtils'
import { getVaultConfig } from './settings'

let vaultRoot: string | null = null

export const CONFLICT_ERROR = 'KNOTE_CONFLICT'

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

export function setVault(root: string): VaultInfo {
  vaultRoot = resolve(root)
  return currentVault()!
}

export function currentVault(): VaultInfo | null {
  if (!vaultRoot) return null
  const parts = vaultRoot.split(sep).filter(Boolean)
  return { root: vaultRoot, name: parts[parts.length - 1] ?? vaultRoot }
}

export function getVaultRoot(): string {
  if (!vaultRoot) throw new Error('No vault is open')
  return vaultRoot
}

/** Resolve a vault-relative path to absolute, refusing anything that escapes the vault. */
export function toAbs(rel: VaultPath): string {
  const root = getVaultRoot()
  const norm = normalizeRel(rel)
  if (norm.split('/').includes('..')) throw new Error(`Invalid path: ${rel}`)
  const abs = resolve(root, norm)
  if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`Path escapes vault: ${rel}`)
  return abs
}

export function toRel(absPath: string): VaultPath {
  const root = getVaultRoot()
  const abs = resolve(absPath)
  if (abs === root) return ''
  if (!abs.startsWith(root + sep)) throw new Error(`Path outside vault: ${absPath}`)
  return normalizeRel(abs.slice(root.length + 1))
}

const IGNORED_DIRS = new Set(['.knote', '.git', '.obsidian', 'node_modules'])

export function isIgnoredRel(rel: string): boolean {
  return normalizeRel(rel)
    .split('/')
    .some((seg) => IGNORED_DIRS.has(seg) || (seg.startsWith('.') && seg !== ''))
}

function isVisibleFile(name: string): boolean {
  return isMarkdown(name) || isImage(name)
}

export async function buildTree(): Promise<FileEntry[]> {
  const root = getVaultRoot()
  const config = await getVaultConfig()
  const weeklyFolder = normalizeRel(config.weeklyFolder)

  async function walk(absDir: string, relDir: string): Promise<FileEntry[]> {
    let dirents
    try {
      dirents = await fs.readdir(absDir, { withFileTypes: true })
    } catch {
      return []
    }
    const folders: FileEntry[] = []
    const files: FileEntry[] = []
    for (const d of dirents) {
      const rel = joinRel(relDir, d.name)
      if (d.isDirectory()) {
        if (IGNORED_DIRS.has(d.name) || d.name.startsWith('.')) continue
        folders.push({
          path: rel,
          name: d.name,
          kind: 'folder',
          children: await walk(join(absDir, d.name), rel)
        })
      } else if (d.isFile()) {
        if (d.name.startsWith('.') || !isVisibleFile(d.name)) continue
        files.push({ path: rel, name: d.name, kind: 'file' })
      }
    }
    // numeric: true makes embedded numbers compare by value (so "9" sorts
    // before "12"), which is what keeps date-stamped file names like weekly
    // notes in chronological order instead of plain lexicographic order.
    const byName = (a: FileEntry, b: FileEntry): number =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    folders.sort(byName)
    // The weekly notes folder reads newest-first; every other folder stays A-Z.
    files.sort(relDir === weeklyFolder ? (a, b) => byName(b, a) : byName)
    return [...folders, ...files]
  }

  return walk(root, '')
}

export async function readFile(rel: VaultPath): Promise<FileReadResult> {
  const abs = toAbs(rel)
  const [content, stat] = await Promise.all([fs.readFile(abs, 'utf-8'), fs.stat(abs)])
  knownContentMarker(abs, content)
  return { path: normalizeRel(rel), content, mtimeMs: stat.mtimeMs }
}

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
  const tmp = abs + '.knote-tmp'
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

export async function renameEntry(rel: VaultPath, newName: string): Promise<VaultPath> {
  if (/[\\/:*?"<>|]/.test(newName)) throw new Error(`Invalid name: ${newName}`)
  const from = toAbs(rel)
  const targetRel = joinRel(parentOf(rel), newName)
  if (normalizeRel(targetRel) === normalizeRel(rel)) return normalizeRel(rel)
  const to = toAbs(targetRel)
  if (await exists(to)) throw new Error(`"${newName}" already exists`)
  ownWriteMarker(from)
  ownWriteMarker(to)
  await fs.rename(from, to)
  return targetRel
}

export async function moveEntry(rel: VaultPath, targetFolder: VaultPath): Promise<VaultPath> {
  const from = toAbs(rel)
  const name = nameOf(rel)
  const targetRel = await uniquify(joinRel(targetFolder, name))
  const to = toAbs(targetRel)
  if (normalizeRel(targetRel) === normalizeRel(rel)) return normalizeRel(rel)
  // Refuse moving a folder into itself/descendant
  if ((to + sep).startsWith(from + sep)) throw new Error('Cannot move a folder into itself')
  await fs.mkdir(dirname(to), { recursive: true })
  ownWriteMarker(from)
  ownWriteMarker(to)
  await fs.rename(from, to)
  return targetRel
}

export async function deleteEntry(rel: VaultPath): Promise<void> {
  const abs = toAbs(rel)
  ownWriteMarker(abs)
  await shell.trashItem(abs)
}
