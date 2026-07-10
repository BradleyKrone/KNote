import { create } from 'zustand'
import type { IndexDelta, LinkRef, NoteMeta, VaultPath } from '@shared/types'
import { normalizeRel, samePath } from '@shared/pathUtils'

interface IndexState {
  /** Replaced (new Map) on every change so selectors re-run. */
  notes: Map<string, NoteMeta>
  hydrate: () => Promise<void>
  applyDelta: (delta: IndexDelta) => void
  clear: () => void
}

export const useIndexStore = create<IndexState>((set, get) => ({
  notes: new Map(),

  hydrate: async () => {
    const snapshot = await window.knote.getIndexSnapshot()
    set({ notes: new Map(snapshot.map((m) => [m.path, m])) })
  },

  applyDelta: (delta) => {
    const notes = new Map(get().notes)
    if (delta.meta === null) notes.delete(delta.path)
    else notes.set(delta.path, delta.meta)
    set({ notes })
  },

  clear: () => set({ notes: new Map() })
}))

/**
 * Resolve a wiki-link target to a note path, Obsidian-style:
 * exact path > path suffix > title > alias, all case-insensitive.
 */
export function resolveTarget(target: string, notes?: Map<string, NoteMeta>): VaultPath | null {
  const all = notes ?? useIndexStore.getState().notes
  const t = normalizeRel(target.trim()).toLowerCase()
  const withMd = t.endsWith('.md') ? t : t + '.md'

  let bestTitle: VaultPath | null = null
  let bestAlias: VaultPath | null = null
  for (const [path, meta] of all) {
    const lower = path.toLowerCase()
    if (lower === withMd) return path
    if (lower.endsWith('/' + withMd)) return path
    if (bestTitle === null && meta.title.toLowerCase() === t) bestTitle = path
    if (bestAlias === null && meta.aliases.some((a) => a.toLowerCase() === t)) bestAlias = path
  }
  return bestTitle ?? bestAlias
}

export interface Backlink {
  path: VaultPath
  title: string
  line: number
  context: string
  link: LinkRef
}

/** Every link in the vault that resolves to the given note. */
export function backlinksFor(notePath: VaultPath): Backlink[] {
  const notes = useIndexStore.getState().notes
  const out: Backlink[] = []
  for (const [path, meta] of notes) {
    if (samePath(path, notePath)) continue
    for (const link of meta.links) {
      const resolved = resolveTarget(link.target, notes)
      if (resolved !== null && samePath(resolved, notePath)) {
        out.push({ path, title: meta.title, line: link.line, context: link.context, link })
      }
    }
  }
  out.sort((a, b) => a.title.localeCompare(b.title) || a.line - b.line)
  return out
}

/** All vault tags with usage counts, nested tags counted under each level. */
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

/** Candidates for the quick switcher and [[ autocomplete. */
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

/**
 * Open a wiki-link target ("Note", "Note#Heading", "folder/Note"), creating
 * the note (Obsidian behavior) if it doesn't exist yet.
 */
export async function openWikiTarget(rawTarget: string): Promise<void> {
  const { useWorkspaceStore } = await import('./workspaceStore')
  const { useVaultStore } = await import('./vaultStore')

  const hashIdx = rawTarget.indexOf('#')
  const target = (hashIdx === -1 ? rawTarget : rawTarget.slice(0, hashIdx)).trim()
  const section = hashIdx === -1 ? null : rawTarget.slice(hashIdx + 1).trim()

  const resolved = resolveTarget(target)
  if (resolved !== null) {
    let scrollToLine: number | undefined
    if (section) {
      const meta = useIndexStore.getState().notes.get(resolved)
      if (section.startsWith('^')) {
        // Block reference: [[Note#^block-id]]
        const id = section.slice(1).toLowerCase()
        const b = meta?.blockIds.find((x) => x.id.toLowerCase() === id)
        if (b) scrollToLine = b.line
      } else {
        const h = meta?.headings.find((x) => x.text.toLowerCase() === section.toLowerCase())
        if (h) scrollToLine = h.line
      }
    }
    await useWorkspaceStore.getState().openFile(resolved, scrollToLine)
    return
  }
  const clean = normalizeRel(target)
  const created = await window.knote.createFile(clean.endsWith('.md') ? clean : clean + '.md', '')
  await useVaultStore.getState().refreshTree()
  await useWorkspaceStore.getState().openFile(created)
}
