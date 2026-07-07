import chokidar, { FSWatcher } from 'chokidar'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { relative, resolve, sep } from 'path'
import type { ExternalChange, ExternalChangeKind } from '@shared/types'
import { normalizeRel } from '@shared/pathUtils'
import { isIgnoredRel } from './vaultService'

/**
 * Watches the vault for filesystem changes and suppresses the echoes of
 * KNote's own writes. For content writes we remember a hash of what we
 * wrote: an event whose file matches the hash is our echo, anything else is
 * a genuine external edit (even if it lands right after our save). For
 * structural ops (rename/move/delete) there is no content, so a short TTL
 * is used instead.
 *
 * Separately, `lastKnownHash` tracks the last content we know is on disk for
 * a file — set whenever we read or write it — with no expiry. Sync clients
 * like OneDrive frequently rewrite a file's bytes identically (rehydrating a
 * cloud placeholder, reconciling metadata) well outside the own-write TTL;
 * without this check those touches surface as false "changed outside KNote"
 * conflicts even though nothing actually changed.
 */

const OWN_WRITE_TTL_MS = 2000

interface OwnWrite {
  time: number
  contentHash: string | null
}

let watcher: FSWatcher | null = null
let watchedRoot: string | null = null
const recentOwnWrites = new Map<string, OwnWrite>()
const lastKnownHash = new Map<string, string>()

function hash(content: string): string {
  return createHash('sha1').update(content, 'utf-8').digest('hex')
}

export function markOwnWrite(absPath: string, content?: string): void {
  const key = resolve(absPath).toLowerCase()
  recentOwnWrites.set(key, {
    time: Date.now(),
    contentHash: content !== undefined ? hash(content) : null
  })
  if (content !== undefined) lastKnownHash.set(key, hash(content))
}

/** Records what we know is currently on disk without it being our own write (e.g. after reading a note into the editor). */
export function markKnownContent(absPath: string, content: string): void {
  lastKnownHash.set(resolve(absPath).toLowerCase(), hash(content))
}

async function isOwnEcho(absPath: string, kind: ExternalChangeKind): Promise<boolean> {
  const key = resolve(absPath).toLowerCase()
  const entry = recentOwnWrites.get(key)
  if (entry === undefined) return false
  if (Date.now() - entry.time > OWN_WRITE_TTL_MS) {
    recentOwnWrites.delete(key)
    return false
  }
  if (entry.contentHash !== null && (kind === 'add' || kind === 'change')) {
    try {
      const current = await fs.readFile(resolve(absPath), 'utf-8')
      return hash(current) === entry.contentHash
    } catch {
      return true // transiently unreadable mid-write: treat as echo
    }
  }
  return true
}

export async function startWatching(
  vaultRoot: string,
  onChange: (change: ExternalChange) => void
): Promise<void> {
  await stopWatching()
  watchedRoot = resolve(vaultRoot)

  watcher = chokidar.watch(watchedRoot, {
    ignoreInitial: true,
    // Don't read files mid-write (editors and sync tools write in chunks)
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    ignored: (path: string) => {
      const rel = toRelSafe(path)
      if (rel === null) return false
      if (rel === '') return false
      if (rel.endsWith('.knote-tmp')) return true
      return isIgnoredRel(rel)
    }
  })

  const emit =
    (kind: ExternalChangeKind) =>
    (absPath: string): void => {
      const rel = toRelSafe(absPath)
      if (rel === null || rel === '') return
      void (async () => {
        if (await isOwnEcho(absPath, kind)) return
        if (kind === 'add' || kind === 'change') {
          const key = resolve(absPath).toLowerCase()
          const prevHash = lastKnownHash.get(key)
          try {
            const content = await fs.readFile(resolve(absPath), 'utf-8')
            const newHash = hash(content)
            if (newHash === prevHash) return // bytes unchanged: a sync client re-touching the file, not a real edit
            lastKnownHash.set(key, newHash)
          } catch {
            // unreadable mid-write race; fall through and still report it
          }
        }
        onChange({ path: rel, kind })
      })()
    }

  watcher.on('add', emit('add'))
  watcher.on('change', emit('change'))
  watcher.on('unlink', (absPath: string) => {
    lastKnownHash.delete(resolve(absPath).toLowerCase())
    emit('unlink')(absPath)
  })
  watcher.on('addDir', emit('addDir'))
  watcher.on('unlinkDir', emit('unlinkDir'))
  watcher.on('error', (err) => {
    // Transient EPERM/EBUSY on Windows during renames — log and keep watching
    console.error('[watcher]', err)
  })
}

function toRelSafe(absPath: string): string | null {
  if (!watchedRoot) return null
  const rel = relative(watchedRoot, resolve(absPath))
  if (rel.startsWith('..') || rel.includes('..' + sep)) return null
  return normalizeRel(rel)
}

export async function stopWatching(): Promise<void> {
  if (watcher) {
    const w = watcher
    watcher = null
    watchedRoot = null
    await w.close().catch(() => {})
  }
  recentOwnWrites.clear()
  lastKnownHash.clear()
}
