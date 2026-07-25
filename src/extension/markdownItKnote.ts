// Teaches VS Code's built-in Markdown preview (Ctrl+Shift+V — KNote's
// "Reading mode") the syntax it doesn't know: `[[wiki links]]`, `![[embeds]]`
// and `#tags`. Contributed via `contributes.markdown.markdownItPlugins` in
// package.json plus the `extendMarkdownIt` export from activate().
//
// Targets resolve to **workspace-root-relative** paths ("/Folder/Note.md")
// rather than command: URIs: the vault *is* the workspace folder, so the
// preview opens such a link and loads such an image natively — no CSP
// exception, no trusted-command plumbing. An unresolved target renders as inert
// text, the same as everywhere else in KNote.

import type MarkdownIt from 'markdown-it'
import type { NoteMeta } from '@shared/types'
import { applyKnoteRules } from '@shared/renderMarkdown'
import { isImage, resolveEmbedPath } from '@shared/pathUtils'
import { resolveTarget, splitWikiTarget } from '@shared/wikiResolve'
import * as vaultIndex from '../core/indexer/vaultIndex'

/**
 * GitHub-style heading slug, matching what VS Code's preview generates for its
 * own heading anchors so `[[Note#Some Heading]]` lands on the right spot.
 * Block references (`#^id`) have no anchor in rendered HTML, so they drop the
 * fragment and just open the note.
 */
function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]/g, '')
    .replace(/\s+/g, '-')
}

function notesMap(): Map<string, NoteMeta> {
  return new Map(vaultIndex.getSnapshot().map((meta) => [meta.path, meta]))
}

/**
 * Apply KNote's rules to the preview's markdown-it instance. Resolution reads
 * the live index on every render, so the preview follows the vault as it
 * changes without needing to be rebuilt.
 */
export function extendMarkdownIt(md: MarkdownIt): MarkdownIt {
  return applyKnoteRules(md, {
    wikiHref: (rawTarget) => {
      const { target, section } = splitWikiTarget(rawTarget)
      const path = resolveTarget(target, notesMap())
      if (path === null) return null
      if (section === null || section.startsWith('^')) return '/' + path
      return `/${path}#${headingSlug(section)}`
    },

    // `extendMarkdownIt` isn't told which note is being rendered, so an image
    // target is resolved as vault-relative. That's the right call for KNote
    // vaults: both paste-image entry points insert `![[/path]]` — vault-root-
    // relative, leading slash — so essentially every embed takes that form. A
    // hand-written note-relative name still resolves correctly for notes at the
    // vault root, and shows as a broken image elsewhere, exactly as it would in
    // any other Markdown editor.
    imageSrc: (target) => {
      const rel = resolveEmbedPath('', target)
      return rel === null || !isImage(rel) ? null : '/' + rel
    }
  })
}
