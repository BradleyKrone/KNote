/**
 * All vault paths in KNote are vault-relative, forward-slash separated,
 * with no leading slash (e.g. "Projects/KNote.md"). This module is the
 * only place path normalization rules live.
 */

export function normalizeRel(p: string): string {
  let out = p.replace(/\\/g, '/')
  out = out.replace(/\/{2,}/g, '/')
  out = out.replace(/^\.\//, '')
  out = out.replace(/^\/+/, '')
  out = out.replace(/\/+$/, '')
  return out
}

export function joinRel(...parts: string[]): string {
  return normalizeRel(parts.filter(Boolean).join('/'))
}

/** Parent folder of a vault path, '' for the vault root. */
export function parentOf(rel: string): string {
  const n = normalizeRel(rel)
  const idx = n.lastIndexOf('/')
  return idx === -1 ? '' : n.slice(0, idx)
}

export function nameOf(rel: string): string {
  const n = normalizeRel(rel)
  const idx = n.lastIndexOf('/')
  return idx === -1 ? n : n.slice(idx + 1)
}

function extOf(rel: string): string {
  const name = nameOf(rel)
  const idx = name.lastIndexOf('.')
  return idx <= 0 ? '' : name.slice(idx + 1).toLowerCase()
}

/** Note title = file name without the .md extension. */
export function titleOf(rel: string): string {
  const name = nameOf(rel)
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name
}

export function isMarkdown(rel: string): boolean {
  return extOf(rel) === 'md'
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif'])

export function isImage(rel: string): boolean {
  return IMAGE_EXTS.has(extOf(rel))
}

/** True if `rel` is `folder` itself or inside it. */
export function isInside(rel: string, folder: string): boolean {
  if (folder === '') return true
  const n = normalizeRel(rel)
  const f = normalizeRel(folder)
  return n === f || n.startsWith(f + '/')
}

/** Case-insensitive path equality (NTFS/macOS friendliness). */
export function samePath(a: string, b: string): boolean {
  return normalizeRel(a).toLowerCase() === normalizeRel(b).toLowerCase()
}

/**
 * Resolve a (possibly percent-encoded) markdown/wiki image target against the
 * folder of the note that references it. A leading "/" means vault-root-
 * relative regardless of that folder. Returns null if the target's "../"
 * segments would escape the vault root.
 */
export function resolveEmbedPath(baseFolder: string, target: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(target)
  } catch {
    decoded = target
  }
  const raw = decoded.startsWith('/')
    ? decoded.slice(1)
    : baseFolder
      ? `${baseFolder}/${decoded}`
      : decoded
  const out: string[] = []
  for (const part of raw.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
    } else {
      out.push(part)
    }
  }
  return out.join('/')
}
