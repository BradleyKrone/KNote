// Hovering a [[wiki-link]] shows the first lines of the target note.

import * as vscode from 'vscode'
import { WIKI_LINK_RE } from '@shared/parser/patterns'
import { resolveTarget, splitWikiTarget } from '@shared/wikiResolve'
import * as vaultIndex from '../../core/indexer/vaultIndex'
import { notesMap } from '../engine'
import { vaultNoteRel } from '../paths'

const PREVIEW_LINES = 15

class WikiLinkHoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    if (vaultNoteRel(document) === null) return undefined
    const text = document.lineAt(position.line).text
    WIKI_LINK_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = WIKI_LINK_RE.exec(text)) !== null) {
      const start = m.index
      const end = m.index + m[0].length
      if (position.character < start || position.character > end) continue

      const { target } = splitWikiTarget(m[2].trim() + (m[3] ?? ''))
      const resolved = resolveTarget(target, notesMap())
      if (!resolved) {
        return new vscode.Hover(
          new vscode.MarkdownString(`_Not created yet — click to create **${target}**_`),
          new vscode.Range(position.line, start, position.line, end)
        )
      }
      const content = vaultIndex.getContent(resolved)
      if (content === undefined) return undefined
      const preview = content.split(/\r?\n/).slice(0, PREVIEW_LINES).join('\n')
      const md = new vscode.MarkdownString()
      md.appendMarkdown(`**${resolved}**\n\n---\n\n`)
      md.appendMarkdown(preview)
      return new vscode.Hover(md, new vscode.Range(position.line, start, position.line, end))
    }
    return undefined
  }
}

export function registerHover(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: 'markdown', scheme: 'file' },
      new WikiLinkHoverProvider()
    )
  )
}
