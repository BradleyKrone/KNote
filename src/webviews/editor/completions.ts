// Autocomplete for the live-preview editor: #tags and [[wiki links]] (note
// titles/aliases, plus [[Note#heading and [[Note#^block section refs). As the
// user types after the trigger, CodeMirror filters and re-sorts the list.
//
// Mirrors the host-side CompletionItemProvider
// (extension/providers/completions.ts) so both the native VS Code markdown
// editor and this webview editor offer the same suggestions — but sourced from
// the webview's in-memory index store rather than the extension host.

import { autocompletion, type CompletionContext, type CompletionResult, type Completion } from '@codemirror/autocomplete'
import type { NoteMeta, VaultPath } from '@shared/types'
import { noteCandidates, resolveTarget, tagCounts } from '@shared/wikiResolve'
import { useIndexStore, useConfigStore } from '../shared/stores'

/** `[[partial` with no closing bracket / heading / alias yet. */
const WIKI_NOTE_PARTIAL = /\[\[([^\][|#]*)$/
/** `[[Note#partial` (or `[[Note#^partial` for block refs). */
const WIKI_SECTION_PARTIAL = /\[\[([^\][|#]+)#(\^?[^\][|#]*)$/
/** `#partial` in normal prose (start of line / whitespace / bracket before the #). */
const TAG_PARTIAL = /(^|[\s([{])#([A-Za-z0-9_/-]*)$/

/** Text still valid to keep filtering the tag list without re-querying. */
const TAG_VALID = /^[A-Za-z0-9_/-]*$/
/** Text still valid inside a `[[...` target/section before a `]`, `|` or `#`. */
const WIKI_VALID = /^[^\][|#]*$/
const BLOCK_VALID = /^\^[^\][|#]*$/

function closeBrackets(suffix: string): string {
  return suffix.startsWith(']]') ? '' : ']]'
}

function tagResult(m: RegExpExecArray, context: CompletionContext, notes: Map<VaultPath, NoteMeta>): CompletionResult {
  const partial = m[2]
  const from = context.pos - partial.length
  const deprecated = new Set(
    useConfigStore.getState().vaultConfig.deprecatedTags.map((t) => t.toLowerCase())
  )
  const options: Completion[] = [...tagCounts(notes).entries()]
    .filter(([tag]) => !deprecated.has(tag.toLowerCase()))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    // Popularity ordering when nothing is typed yet; a gentle negative boost
    // that decays so a strong prefix match still wins once the user types.
    .map(([tag, count], i) => ({
      label: tag,
      type: 'keyword',
      detail: `${count} note${count === 1 ? '' : 's'}`,
      boost: Math.max(-20, -i)
    }))
  return { from, options, validFor: TAG_VALID }
}

function noteResult(
  m: RegExpExecArray,
  context: CompletionContext,
  suffix: string,
  notes: Map<VaultPath, NoteMeta>
): CompletionResult {
  const partial = m[1]
  const from = context.pos - partial.length
  const close = closeBrackets(suffix)
  const options: Completion[] = noteCandidates(notes).map((c) => {
    const label = c.alias ?? c.title
    return {
      label,
      type: 'variable',
      detail: c.alias ? `${c.title} (alias)` : c.path,
      apply: (c.alias ? `${c.title}|${c.alias}` : c.title) + close
    }
  })
  return { from, options, validFor: WIKI_VALID }
}

function sectionResult(
  m: RegExpExecArray,
  context: CompletionContext,
  suffix: string,
  notes: Map<VaultPath, NoteMeta>
): CompletionResult | null {
  const [, target, partial] = m
  const resolved = resolveTarget(target, notes)
  if (!resolved) return null
  const meta = notes.get(resolved)
  if (!meta) return null
  const from = context.pos - partial.length
  const close = closeBrackets(suffix)
  if (partial.startsWith('^')) {
    const options: Completion[] = meta.blockIds.map((b) => ({
      label: `^${b.id}`,
      type: 'property',
      apply: `^${b.id}${close}`
    }))
    return { from, options, validFor: BLOCK_VALID }
  }
  const options: Completion[] = meta.headings.map((h) => ({
    label: h.text,
    type: 'property',
    detail: '#'.repeat(h.level),
    apply: h.text + close
  }))
  return { from, options, validFor: WIKI_VALID }
}

function knoteCompletions(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const col = context.pos - line.from
  const prefix = line.text.slice(0, col)
  const suffix = line.text.slice(col)
  const notes = useIndexStore.getState().notes

  const section = WIKI_SECTION_PARTIAL.exec(prefix)
  if (section) return sectionResult(section, context, suffix, notes)

  const note = WIKI_NOTE_PARTIAL.exec(prefix)
  if (note) return noteResult(note, context, suffix, notes)

  const tag = TAG_PARTIAL.exec(prefix)
  if (tag) return tagResult(tag, context, notes)

  return null
}

/** The autocompletion extension for the live-preview editor. */
export const knoteAutocomplete = autocompletion({ override: [knoteCompletions] })
