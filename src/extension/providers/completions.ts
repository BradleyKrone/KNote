// Autocomplete inside notes: [[note titles + aliases, [[Note#headings and
// [[Note#^block-ids, and #tags (minus deprecated ones).

import * as vscode from 'vscode'
import { getVaultConfig } from '../../core/vaultConfig'
import * as vaultIndex from '../../core/indexer/vaultIndex'
import { noteCandidates, resolveTarget, tagCounts } from '@shared/wikiResolve'
import { notesMap } from '../engine'
import { vaultNoteRel } from '../paths'

/** `[[partial` with no closing bracket / heading / alias yet. */
const WIKI_NOTE_PARTIAL = /\[\[([^\][|#]*)$/
/** `[[Note#partial` (or `[[Note#^partial` for block refs). */
const WIKI_SECTION_PARTIAL = /\[\[([^\][|#]+)#(\^?[^\][|#]*)$/
/** `#partial` in normal prose (start of line / whitespace / bracket before the #). */
const TAG_PARTIAL = /(^|[\s([{])#([A-Za-z0-9_/-]*)$/

function closeBrackets(lineSuffix: string): string {
  return lineSuffix.startsWith(']]') ? '' : ']]'
}

class KnoteCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[] | undefined> {
    if (vaultNoteRel(document) === null) return undefined
    const line = document.lineAt(position.line).text
    const prefix = line.slice(0, position.character)
    const suffix = line.slice(position.character)

    const section = WIKI_SECTION_PARTIAL.exec(prefix)
    if (section) return this.sectionItems(section, position, suffix)

    const note = WIKI_NOTE_PARTIAL.exec(prefix)
    if (note) return this.noteItems(note, position, suffix)

    const tag = TAG_PARTIAL.exec(prefix)
    if (tag) return this.tagItems(tag, position)

    return undefined
  }

  private noteItems(
    m: RegExpExecArray,
    position: vscode.Position,
    suffix: string
  ): vscode.CompletionItem[] {
    const replaceRange = new vscode.Range(
      position.line,
      position.character - m[1].length,
      position.line,
      position.character
    )
    const close = closeBrackets(suffix)
    return noteCandidates(notesMap()).map((c, i) => {
      const label = c.alias ?? c.title
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.File)
      item.detail = c.alias ? `${c.title} (alias)` : c.path
      item.insertText = (c.alias ? `${c.title}|${c.alias}` : c.title) + close
      item.range = replaceRange
      item.sortText = String(i).padStart(6, '0')
      return item
    })
  }

  private sectionItems(
    m: RegExpExecArray,
    position: vscode.Position,
    suffix: string
  ): vscode.CompletionItem[] | undefined {
    const [, target, partial] = m
    const resolved = resolveTarget(target, notesMap())
    if (!resolved) return undefined
    const meta = vaultIndex.getNote(resolved)
    if (!meta) return undefined
    const replaceRange = new vscode.Range(
      position.line,
      position.character - partial.length,
      position.line,
      position.character
    )
    const close = closeBrackets(suffix)
    if (partial.startsWith('^')) {
      return meta.blockIds.map((b) => {
        const item = new vscode.CompletionItem(`^${b.id}`, vscode.CompletionItemKind.Reference)
        item.insertText = `^${b.id}${close}`
        item.range = replaceRange
        return item
      })
    }
    return meta.headings.map((h) => {
      const item = new vscode.CompletionItem(h.text, vscode.CompletionItemKind.Reference)
      item.detail = '#'.repeat(h.level)
      item.insertText = h.text + close
      item.range = replaceRange
      return item
    })
  }

  private async tagItems(
    m: RegExpExecArray,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[]> {
    const partial = m[2]
    const replaceRange = new vscode.Range(
      position.line,
      position.character - partial.length,
      position.line,
      position.character
    )
    const config = await getVaultConfig()
    const deprecated = new Set(config.deprecatedTags.map((t) => t.toLowerCase()))
    const counts = tagCounts(notesMap())
    return [...counts.entries()]
      .filter(([tag]) => !deprecated.has(tag.toLowerCase()))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count], i) => {
        const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Keyword)
        item.detail = `${count} note${count === 1 ? '' : 's'}`
        item.insertText = tag
        item.range = replaceRange
        item.sortText = String(i).padStart(6, '0')
        return item
      })
  }
}

export function registerCompletions(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'markdown', scheme: 'file' },
      new KnoteCompletionProvider(),
      '[',
      '#',
      '^',
      '|'
    )
  )
}
