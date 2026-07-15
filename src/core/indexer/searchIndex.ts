// MiniSearch-backed full-text search over note titles/content, combined
// with the operator filters from shared/searchQuery (path:/tag:/file:) and
// snippet extraction for the results panel.

import MiniSearch from 'minisearch'
import type { NoteMeta, SearchResult, VaultPath } from '@shared/types'
import { nameOf } from '@shared/pathUtils'
import { parseSearchQuery } from '@shared/searchQuery'
import * as vaultIndex from './vaultIndex'

interface SearchDoc {
  path: string
  title: string
  content: string
  tags: string
}

function createMini(): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    idField: 'path',
    fields: ['title', 'content', 'tags'],
    storeFields: ['title'],
    searchOptions: {
      boost: { title: 3, tags: 2 },
      prefix: true,
      combineWith: 'AND'
    }
  })
}

let mini = createMini()
const indexed = new Set<string>()

export function reset(): void {
  mini = createMini()
  indexed.clear()
}

export function update(meta: NoteMeta, content: string): void {
  if (indexed.has(meta.path)) mini.discard(meta.path)
  mini.add({
    path: meta.path,
    title: meta.title,
    content,
    tags: meta.tags.map((t) => t.tag).join(' ')
  })
  indexed.add(meta.path)
}

export function remove(path: VaultPath): void {
  if (!indexed.has(path)) return
  mini.discard(path)
  indexed.delete(path)
}

function findSnippet(content: string, needles: string[]): { line: number; text: string } | null {
  const lower = content.toLowerCase()
  for (const needle of needles) {
    const idx = lower.indexOf(needle.toLowerCase())
    if (idx === -1) continue
    const line = content.slice(0, idx).split('\n').length - 1
    const text = content.split('\n')[line]?.replace(/\r$/, '') ?? ''
    return { line, text: text.trim() }
  }
  return null
}

function tagMatches(noteTags: string[], wanted: string): boolean {
  const w = wanted.toLowerCase()
  // Sentinel: `tag:none` means "notes with zero tags" — this shadows a
  // literal tag named "none", which becomes unsearchable via tag:none.
  if (w === 'none') return noteTags.length === 0
  return noteTags.some((t) => {
    const lt = t.toLowerCase()
    return lt === w || lt.startsWith(w + '/')
  })
}

export function search(query: string): SearchResult[] {
  const parsed = parseSearchQuery(query)
  const hasTextQuery = parsed.terms.length > 0

  // Candidate set: MiniSearch ranking when there are free-text terms,
  // otherwise every indexed note (operator/phrase-only queries).
  const scores = new Map<string, number>()
  if (hasTextQuery) {
    for (const r of mini.search(parsed.terms.join(' '))) {
      scores.set(String(r.id), r.score)
    }
  } else {
    for (const path of indexed) scores.set(path, 1)
  }

  const results: SearchResult[] = []
  for (const [path, score] of scores) {
    const meta = vaultIndex.getNote(path)
    const content = vaultIndex.getContent(path)
    if (!meta || content === undefined) continue

    const lowerPath = path.toLowerCase()
    if (parsed.path.length && !parsed.path.every((p) => lowerPath.includes(p.toLowerCase())))
      continue
    if (
      parsed.file.length &&
      !parsed.file.every((f) => nameOf(path).toLowerCase().includes(f.toLowerCase()))
    ) {
      continue
    }
    const noteTags = meta.tags.map((t) => t.tag)
    if (parsed.tag.length && !parsed.tag.every((t) => tagMatches(noteTags, t))) continue

    const lowerContent = content.toLowerCase()
    if (
      parsed.phrases.length &&
      !parsed.phrases.every((p) => lowerContent.includes(p.toLowerCase()))
    ) {
      continue
    }
    if (
      parsed.excludes.some(
        (x) =>
          lowerContent.includes(x.toLowerCase()) ||
          meta.title.toLowerCase().includes(x.toLowerCase())
      )
    ) {
      continue
    }

    results.push({
      path,
      title: meta.title,
      score,
      snippet: findSnippet(content, [...parsed.phrases, ...parsed.terms])
    })
  }

  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
  return results.slice(0, 100)
}
