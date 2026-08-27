// "KNote: Export Note to PDF" — renders the active note through the same
// markdown-it pipeline as embeds/hover previews (see shared/renderMarkdown.ts)
// into a plain WebviewPanel, then lets the user trigger the OS print dialog
// from inside it. VS Code's webviews run on the same Chromium as the rest of
// the app, so `window.print()` there opens the native print dialog with a
// "Save as PDF" destination — no headless-browser dependency, no network,
// same trick Obsidian's own PDF export relies on.

import * as vscode from 'vscode'
import { randomBytes } from 'crypto'
import { createRenderer } from '@shared/renderMarkdown'
import { isImage, resolveEmbedPath } from '@shared/pathUtils'
import { resolveTarget, splitWikiTarget } from '@shared/wikiResolve'
import type { NoteMeta } from '@shared/types'
import * as vault from '../../core/vaultService'
import * as vaultIndex from '../../core/indexer/vaultIndex'
import { currentVaultRoot } from '../engine'
import { openDocFor, tabNoteRel } from '../paths'
import { webviewResourceRoots } from '../views/webviewHtml'

const VIEW_TYPE = 'knote.exportPdf'

// Matches vaultService's own frontmatter fence — stripped here because a raw
// `---\nkey: value\n---` block renders as ugly literal paragraphs through this
// renderer (unlike VS Code's own preview, it has no frontmatter plugin), and a
// document meant to be handed to someone outside KNote shouldn't carry it.
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/

function folderOf(noteRel: string): string {
  return noteRel.includes('/') ? noteRel.slice(0, noteRel.lastIndexOf('/')) : ''
}

function titleFor(rel: string): string {
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  return base.replace(/\.md$/i, '')
}

/**
 * Render a note's markdown to HTML for the export webview. Wiki-links resolve
 * to `#` (non-functional in a printed document, but distinguishes a real link
 * from a genuinely broken one — same "unresolved" styling Reading mode uses).
 * Images resolve to webview URIs synchronously: unlike attachmentUriFor, this
 * is a one-shot render with no cache-busting or existence check to await.
 */
function renderNoteHtml(source: string, noteRel: string, webview: vscode.Webview): string {
  const folder = folderOf(noteRel)
  const notes = new Map(vaultIndex.getSnapshot().map((meta: NoteMeta) => [meta.path, meta]))

  const resolveImage = (target: string): string | null => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target // http(s):, data: — already usable
    const rel = resolveEmbedPath(folder, target)
    if (!rel || !isImage(rel)) return null
    try {
      return webview.asWebviewUri(vscode.Uri.file(vault.toAbs(rel))).toString()
    } catch {
      return null
    }
  }

  const md = createRenderer({
    wikiHref: (rawTarget) => {
      const { target } = splitWikiTarget(rawTarget)
      return resolveTarget(target, notes) === null ? null : '#'
    },
    imageSrc: resolveImage
  })

  // `![[embed]]` images go through opts.imageSrc above; a plain `![alt](path)`
  // bypasses it entirely (markdown-it's own image rule renders `src` as-is),
  // so route that form through the same resolver.
  const defaultImageRule =
    md.renderer.rules.image ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const src = token.attrGet('src')
    if (src) {
      const resolved = resolveImage(src)
      if (resolved) token.attrSet('src', resolved)
    }
    return defaultImageRule(tokens, idx, options, env, self)
  }

  return md.render(source.replace(FRONTMATTER_RE, ''))
}

function buildExportHtml(webview: vscode.Webview, title: string, bodyHtml: string): string {
  const nonce = randomBytes(16).toString('base64')
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`
  ].join('; ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  :root { color-scheme: light; }
  body {
    background: #fff;
    color: #1a1a1a;
    font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    line-height: 1.55;
    max-width: 780px;
    margin: 0 auto;
    padding: 2.5em 2em 4em;
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.5em; }
  h1 { font-size: 1.9em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.2em; }
  p, ul, ol, blockquote, table, pre { margin: 0.7em 0; }
  blockquote { border-left: 3px solid #ccc; margin-left: 0; padding: 0 1em; color: #555; }
  code { background: #f2f2f2; border-radius: 3px; padding: 0.1em 0.35em; font-size: 0.9em; }
  pre { background: #f6f6f6; border: 1px solid #e5e5e5; border-radius: 6px; padding: 0.9em 1em; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 0.4em 0.7em; text-align: left; }
  img.knote-embed-image { max-width: 100%; page-break-inside: avoid; }
  img.knote-embed-image-drawio { background: #fff; border: 1px solid #eee; border-radius: 4px; padding: 4px; }
  .knote-embed-missing::after { content: ' \\26A0 not found'; color: #c00; font-size: 0.85em; }
  .knote-wikilink { color: #1a1a1a; text-decoration: underline; }
  .knote-unresolved { color: #777; text-decoration: underline dotted; }
  .knote-tag { background: #e3e3e3; border-radius: 8px; padding: 0.05em 0.5em; font-size: 0.85em; white-space: nowrap; }
  .hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }
  .hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-type { color: #d73a49; }
  .hljs-string, .hljs-attr { color: #032f62; }
  .hljs-number { color: #005cc5; }
  .hljs-title, .hljs-title.function_, .hljs-title.class_ { color: #6f42c1; }
  .hljs-built_in { color: #005cc5; }
  .knote-export-bar {
    position: sticky;
    top: 0;
    display: flex;
    align-items: center;
    gap: 0.75em;
    background: #f6f6f6;
    border: 1px solid #ddd;
    border-radius: 6px;
    padding: 0.6em 1em;
    margin-bottom: 1.5em;
  }
  .knote-export-bar button {
    font: inherit;
    padding: 0.35em 0.9em;
    border-radius: 4px;
    border: 1px solid #bbb;
    background: #fff;
    cursor: pointer;
  }
  .knote-export-bar button:hover { background: #eee; }
  .knote-export-hint { color: #666; font-size: 0.9em; }
  @media print {
    .knote-export-bar { display: none; }
    body { max-width: none; padding: 0; }
  }
</style>
</head>
<body>
<div class="knote-export-bar">
  <button id="knote-export-print">Print / Save as PDF…</button>
  <span class="knote-export-hint">Choose "Save as PDF" (or your PDF printer) in the dialog that opens.</span>
</div>
<div class="knote-export-body">
${bodyHtml}
</div>
<script nonce="${nonce}">
  document.getElementById('knote-export-print').addEventListener('click', () => window.print())
</script>
</body>
</html>`
}

async function exportActiveNoteToPdf(context: vscode.ExtensionContext): Promise<void> {
  if (!currentVaultRoot()) {
    void vscode.window.showWarningMessage('KNote: no vault is open in this workspace.')
    return
  }
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab
  const rel = tab ? tabNoteRel(tab) : null
  if (rel === null) {
    void vscode.window.showWarningMessage('KNote: open a vault note first.')
    return
  }

  const source = openDocFor(rel)?.getText() ?? (await vault.readFile(rel)).content
  const title = titleFor(rel)

  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    `Export: ${title}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: webviewResourceRoots(context.extensionUri, currentVaultRoot())
    }
  )
  const bodyHtml = renderNoteHtml(source, rel, panel.webview)
  panel.webview.html = buildExportHtml(panel.webview, title, bodyHtml)
}

export function registerExportPdfCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('knote.exportNoteToPdf', () => exportActiveNoteToPdf(context))
  )
}
