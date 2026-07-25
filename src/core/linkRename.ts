// Vault-wide wiki-link rewrite for note renames/moves — the Obsidian
// "automatically update internal links" behavior.
//
// Mirrors tagRename.ts's mask-then-regex strategy (shared maskSource
// scaffold) so a match here is exactly a link parseNote would have found,
// then splices the replacement into the *unmasked* source. Unlike tagRename,
// this module only plans the rewrite and hands back whole-file contents —
// the extension host turns those into one WorkspaceEdit so the rewrite shares
// a single undo step with the rename itself (see extension/renameLinks.ts).

import type { NoteMeta, VaultPath } from '@shared/types'
import { WIKI_LINK_RE } from '@shared/parser/patterns'
import { maskSource } from '@shared/parser/mdScaffold'
import { normalizeRel, samePath, titleOf } from '@shared/pathUtils'
import { resolveTarget } from '@shared/wikiResolve'

/**
 * True when `target` reaches `meta` *only* through one of its aliases. Such a
 * link must be left alone: the alias travels with the note, so it still
 * resolves after the rename, and rewriting it would destroy what the author
 * chose to write. Mirrors resolveTarget's rules (path > path suffix > title >
 * alias) — anything the first three match is not alias-only.
 */
function isAliasOnly(target: string, meta: NoteMeta): boolean {
  const t = normalizeRel(target.trim()).toLowerCase()
  const withMd = t.endsWith('.md') ? t : t + '.md'
  const lower = meta.path.toLowerCase()
  if (lower === withMd || lower.endsWith('/' + withMd)) return false
  if (meta.title.toLowerCase() === t) return false
  return true
}

/**
 * True when a note other than `oldPath` would also answer to `title` — so a
 * bare-title link is ambiguous once the rename lands and has to carry a path
 * instead. `oldPath` is excluded because that note is the one being renamed;
 * the index still holds it under its old title.
 */
function titleIsAmbiguous(
  title: string,
  oldPath: VaultPath,
  notes: Map<string, NoteMeta>
): boolean {
  const lower = title.toLowerCase()
  for (const [path, meta] of notes) {
    if (!samePath(path, oldPath) && meta.title.toLowerCase() === lower) return true
  }
  return false
}

/**
 * The replacement note-part for a link that pointed at `oldPath` and must now
 * point at `newPath`, preserving the form the author wrote. The form comes from
 * the target *text*, not from which resolution rule fired — for a root-level
 * note, a bare `[[Target]]` matches resolveTarget's exact-path rule and the
 * title rule identically, so the rule can't tell the two forms apart:
 *
 *  - **Bare form** (no `/` in the target) → the new title, so `[[Old]]` becomes
 *    `[[New]]`, and a pure folder *move* leaves the link untouched. Falls back
 *    to the full path when the new title would be ambiguous.
 *  - **Path form** → the full new path, keeping the `.md` suffix only if the
 *    original target had one. A partial (suffix) path is deliberately widened
 *    to the full path rather than guessed at — always correct, if sometimes
 *    more verbose than the author wrote.
 */
function newTargetText(
  target: string,
  oldPath: VaultPath,
  newPath: VaultPath,
  notes: Map<string, NoteMeta>
): string {
  const trimmed = target.trim()
  const newTitle = titleOf(newPath)
  const isBare = !normalizeRel(trimmed).includes('/')
  if (isBare && !titleIsAmbiguous(newTitle, oldPath, notes)) return newTitle
  const full = normalizeRel(newPath)
  return trimmed.toLowerCase().endsWith('.md') ? full : full.replace(/\.md$/i, '')
}

/**
 * Rewrite every wiki link in `content` that resolves to `oldPath` so it points
 * at `newPath`. Returns the new content, or null when no link needs changing
 * (same contract as `renameTagInContent`).
 *
 * Links that resolved via an **alias** are left alone: the alias travels with
 * the note, so it still resolves after the rename and rewriting it would
 * destroy the author's intent. The `!` embed prefix, `#section` and
 * `|display text` are all preserved verbatim.
 */
export function renameLinksInContent(
  content: string,
  oldPath: VaultPath,
  newPath: VaultPath,
  notes: Map<string, NoteMeta>
): string | null {
  const oldMeta = notes.get(normalizeRel(oldPath)) ?? findByPath(oldPath, notes)
  if (!oldMeta) return null

  const source = maskSource(content)
  if (!source) return null

  // Collect first, splice back-to-front, so earlier replacements don't shift
  // the offsets of later ones (same as tagRename.ts).
  const replacements: Array<[number, number, string]> = []
  WIKI_LINK_RE.lastIndex = 0
  for (let m = WIKI_LINK_RE.exec(source.masked); m; m = WIKI_LINK_RE.exec(source.masked)) {
    const target = m[2]
    const resolved = resolveTarget(target, notes)
    if (resolved === null || !samePath(resolved, oldPath)) continue
    if (isAliasOnly(target, oldMeta)) continue
    const newTarget = newTargetText(target, oldPath, newPath, notes)
    const replacement = `${m[1]}[[${newTarget}${m[3] ?? ''}${m[4] ?? ''}]]`
    if (replacement !== m[0]) replacements.push([m.index, m.index + m[0].length, replacement])
  }
  if (replacements.length === 0) return null

  let result = content
  for (const [start, end, text] of replacements.reverse()) {
    result = result.slice(0, start) + text + result.slice(end)
  }
  return result
}

/** Case-insensitive lookup, for callers whose path casing may differ from the index key. */
function findByPath(path: VaultPath, notes: Map<string, NoteMeta>): NoteMeta | undefined {
  for (const [key, meta] of notes) {
    if (samePath(key, path)) return meta
  }
  return undefined
}

export interface Rename {
  oldPath: VaultPath
  newPath: VaultPath
}

/**
 * Plan the whole-vault link rewrite for a batch of renames (a folder rename
 * expands to one entry per contained note). Returns `path → new full content`
 * for changed notes only.
 *
 * Renames are applied in sequence to each note's text, so a folder rename —
 * where a renamed note links to another renamed note — settles correctly in
 * one pass. Whole contents (rather than per-link ranges) are returned because
 * sequential rewrites invalidate each other's offsets; the host emits one
 * full-document replace per file instead.
 *
 * `notes` must be the index as it stood *before* the rename, since that's what
 * the links in the files still resolve against.
 */
export function planLinkRenames(
  renames: readonly Rename[],
  contents: Iterable<readonly [VaultPath, string]>,
  notes: Map<string, NoteMeta>
): Map<VaultPath, string> {
  const changed = new Map<VaultPath, string>()
  const effective = renames.filter((r) => !samePath(r.oldPath, r.newPath))
  if (effective.length === 0) return changed

  for (const [path, original] of contents) {
    let current = original
    for (const { oldPath, newPath } of effective) {
      const updated = renameLinksInContent(current, oldPath, newPath, notes)
      if (updated !== null) current = updated
    }
    if (current !== original) changed.set(path, current)
  }
  return changed
}
