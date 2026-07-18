// Pure wiki-link resolution + index-derived selectors shared by the
// extension host and the webviews. All functions take the notes map
// explicitly — no store, no globals.

import type { NoteMeta, VaultPath } from './types'
import { normalizeRel, samePath } from './pathUtils'

/**
 * Resolve a wiki-link target to a note path, Obsidian-style:
 * exact path > path suffix > title > alias, all case-insensitive.
 */
export function resolveTarget(target: string, notes: Map<string, NoteMeta>): VaultPath | null {
  const t = normalizeRel(target.trim()).toLowerCase()
  const withMd = t.endsWith('.md') ? t : t + '.md'

  let bestTitle: VaultPath | null = null
  let bestAlias: VaultPath | null = null
  for (const [path, meta] of notes) {
    const lower = path.toLowerCase()
    if (lower === withMd) return path
    if (lower.endsWith('/' + withMd)) return path
    if (bestTitle === null && meta.title.toLowerCase() === t) bestTitle = path
    if (bestAlias === null && meta.aliases.some((a) => a.toLowerCase() === t)) bestAlias = path
  }
  return bestTitle ?? bestAlias
}

/**
 * Split a raw wiki target ("Note#Heading", "Note#^block") into the note part
 * and the section part (still carrying a leading ^ for block refs).
 */
export function splitWikiTarget(rawTarget: string): { target: string; section: string | null } {
  const hashIdx = rawTarget.indexOf('#')
  return {
    target: (hashIdx === -1 ? rawTarget : rawTarget.slice(0, hashIdx)).trim(),
    section: hashIdx === -1 ? null : rawTarget.slice(hashIdx + 1).trim()
  }
}

/** 0-based line of a `#Heading` / `#^block-id` section within a note, if found. */
export function sectionLine(meta: NoteMeta | undefined, section: string): number | null {
  if (!meta) return null
  if (section.startsWith('^')) {
    const id = section.slice(1).toLowerCase()
    const b = meta.blockIds.find((x) => x.id.toLowerCase() === id)
    return b ? b.line : null
  }
  const h = meta.headings.find((x) => x.text.toLowerCase() === section.toLowerCase())
  return h ? h.line : null
}

export interface Backlink {
  path: VaultPath
  title: string
  line: number
  context: string
}

/** Every link in the vault that resolves to the given note. */
export function backlinksFor(notePath: VaultPath, notes: Map<string, NoteMeta>): Backlink[] {
  const out: Backlink[] = []
  for (const [path, meta] of notes) {
    if (samePath(path, notePath)) continue
    for (const link of meta.links) {
      const resolved = resolveTarget(link.target, notes)
      if (resolved !== null && samePath(resolved, notePath)) {
        out.push({ path, title: meta.title, line: link.line, context: link.context })
      }
    }
  }
  out.sort((a, b) => a.title.localeCompare(b.title) || a.line - b.line)
  return out
}

/** All vault tags with usage counts. */
export function tagCounts(notes: Map<string, NoteMeta>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const meta of notes.values()) {
    for (const t of meta.tags) {
      counts.set(t.tag, (counts.get(t.tag) ?? 0) + 1)
    }
  }
  return counts
}

/** Count of notes with zero tags — surfaced as a review bucket in the Tag pane. */
export function untaggedCount(notes: Map<string, NoteMeta>): number {
  let n = 0
  for (const meta of notes.values()) if (meta.tags.length === 0) n++
  return n
}

/** Candidates for [[ autocomplete: one entry per note plus one per alias. */
export interface NoteCandidate {
  path: VaultPath
  title: string
  alias?: string
}

export function noteCandidates(notes: Map<string, NoteMeta>): NoteCandidate[] {
  const out: NoteCandidate[] = []
  for (const meta of notes.values()) {
    out.push({ path: meta.path, title: meta.title })
    for (const alias of meta.aliases) {
      out.push({ path: meta.path, title: meta.title, alias })
    }
  }
  return out
}
