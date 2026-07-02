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
 */

const OWN_WRITE_TTL_MS = 2000

interface OwnWrite {
  time: number
  contentHash: string | null
}

let watcher: FSWatcher | null = null
let watchedRoot: string | null = null
const recentOwnWrites = new Map<string, OwnWrite>()

function hash(content: string): string {
  return createHash('sha1').update(content, 'utf-8').digest('hex')
}

export function markOwnWrite(absPath: string, content?: string): void {
  recentOwnWrites.set(resolve(absPath).toLowerCase(), {
    time: Date.now(),
    contentHash: content !== undefined ? hash(content) : null
  })
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
      void isOwnEcho(absPath, kind).then((echo) => {
        if (!echo) onChange({ path: rel, kind })
      })
    }

  watcher.on('add', emit('add'))
  watcher.on('change', emit('change'))
  watcher.on('unlink', emit('unlink'))
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
}
