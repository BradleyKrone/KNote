import { parse as parseYaml, stringify as yamlStringify } from 'yaml'
import type { VaultPath } from '@shared/types'
import { TAG_RE } from '@shared/parser/patterns'
import { maskSource } from '@shared/parser/mdScaffold'
import { writeFileAtomic } from './vaultService'
import * as vaultIndex from './indexer/vaultIndex'

/**
 * Vault-wide tag rename/merge — e.g. unifying `#knote` and `#KNOTE` into one
 * spelling. Mirrors parseNote's mask-then-regex strategy (shared maskSource
 * scaffold) so a match here is exactly a tag parseNote would have found, then
 * splices the replacement into the *unmasked* source.
 */

function sameTag(candidate: string, target: string): boolean {
  return candidate.toLowerCase() === target.toLowerCase()
}

/** Renames a tag within frontmatter's `tags:`/`tag:` field, preserving array-vs-string form and any `#` prefix on individual entries. */
function renameFrontmatterTag(
  fm: Record<string, unknown>,
  oldTag: string,
  newTag: string
): boolean {
  const key = 'tags' in fm ? 'tags' : 'tag' in fm ? 'tag' : null
  if (!key) return false
  const raw = fm[key]
  const wasString = typeof raw === 'string'
  const entries = wasString
    ? (raw as string).split(',').map((s) => s.trim()).filter(Boolean)
    : Array.isArray(raw)
      ? raw.map((v) => String(v))
      : null
  if (!entries) return false

  let changed = false
  const updated = entries.map((entry) => {
    const bare = entry.replace(/^#/, '')
    if (!sameTag(bare, oldTag)) return entry
    changed = true
    return entry.startsWith('#') ? `#${newTag}` : newTag
  })
  if (!changed) return false
  fm[key] = wasString ? updated.join(', ') : updated
  return true
}

/** Renames a tag in one note's content. Returns the new content, or null if the tag doesn't occur. */
export function renameTagInContent(content: string, oldTag: string, newTag: string): string | null {
  const source = maskSource(content)
  if (!source) return null
  const { masked, yaml: yamlNode } = source
  let result = content
  let changed = false

  // --- Body tags (outside code/frontmatter) first, back-to-front so earlier
  // replacements don't shift later offsets. These offsets all fall strictly
  // after the frontmatter block (which is masked to spaces, so it can't
  // contain a `#` match), so editing the body first doesn't disturb the
  // frontmatter offsets used below.
  const replacements: Array<[number, number, string]> = []
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(masked)) !== null) {
    const tag = m[2]
    if (sameTag(tag, oldTag)) {
      const start = m.index + m[1].length
      replacements.push([start, start + 1 + tag.length, `#${newTag}`])
    }
  }
  if (replacements.length > 0) {
    changed = true
    for (const [start, end, text] of replacements.reverse()) {
      result = result.slice(0, start) + text + result.slice(end)
    }
  }

  // --- Frontmatter tags, spliced in using the original parse's offsets
  // (still valid: body edits above only touch content after this range).
  if (yamlNode) {
    const { from, to, value } = yamlNode
    try {
      const parsed = parseYaml(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const fm = parsed as Record<string, unknown>
        if (renameFrontmatterTag(fm, oldTag, newTag)) {
          const block = `---\n${yamlStringify(fm).trimEnd()}\n---`
          result = result.slice(0, from) + block + result.slice(to)
          changed = true
        }
      }
    } catch {
      // Unparseable frontmatter: leave it untouched
    }
  }

  return changed ? result : null
}

export interface TagRenameResult {
  filesChanged: VaultPath[]
}

/** Renames/merges a tag across every note in the vault, writing changed files atomically and refreshing the in-memory index. */
export async function renameTagAcrossVault(oldTag: string, newTag: string): Promise<TagRenameResult> {
  const from = oldTag.replace(/^#/, '').trim()
  const to = newTag.replace(/^#/, '').trim()
  const filesChanged: VaultPath[] = []
  if (!from || !to || from === to) return { filesChanged }

  for (const [path, content] of vaultIndex.getAllContents()) {
    const updated = renameTagInContent(content, from, to)
    if (updated !== null) {
      await writeFileAtomic(path, updated)
      filesChanged.push(path)
    }
  }
  for (const path of filesChanged) {
    await vaultIndex.indexFile(path)
  }
  return { filesChanged }
}
