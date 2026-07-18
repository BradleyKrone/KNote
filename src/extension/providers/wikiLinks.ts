// [[wiki-link]] navigation in the native editor: a DocumentLinkProvider that
// turns every [[target]], [[target#Heading]], [[target#^block]], and
// [[target|alias]] into a clickable link. Links route through the
// knote.openWikiLink command (a plain file Uri can't land on a heading/block
// line), which also creates missing notes on click — Obsidian behavior.

import * as vscode from 'vscode'
import { WIKI_LINK_RE } from '@shared/parser/patterns'
import { resolveTarget, sectionLine, splitWikiTarget } from '@shared/wikiResolve'
import { normalizeRel } from '@shared/pathUtils'
import * as vaultIndex from '../../core/indexer/vaultIndex'
import * as vault from '../../core/vaultService'
import { notesMap } from '../engine'
import { uriForRel, vaultNoteRel } from '../paths'
import { openNoteInLiveEditor } from '../views/liveEditorProvider'

function commandUri(rawTarget: string): vscode.Uri {
  return vscode.Uri.parse(
    `command:knote.openWikiLink?${encodeURIComponent(JSON.stringify([rawTarget]))}`
  )
}

class WikiLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    if (vaultNoteRel(document) === null) return []
    const links: vscode.DocumentLink[] = []
    for (let i = 0; i < document.lineCount; i++) {
      const text = document.lineAt(i).text
      WIKI_LINK_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = WIKI_LINK_RE.exec(text)) !== null) {
        const [, bang, target, heading] = m
        const raw = target.trim() + (heading ?? '')
        // Clickable region: the inner text between the brackets
        const innerStart = m.index + bang.length + 2
        const innerEnd = m.index + m[0].length - 2
        const link = new vscode.DocumentLink(
          new vscode.Range(i, innerStart, i, innerEnd),
          commandUri(raw)
        )
        const resolved = resolveTarget(target, notesMap())
        link.tooltip = resolved ? `Open "${resolved}"` : `Create "${target.trim()}"`
        links.push(link)
      }
    }
    return links
  }
}

export async function openWikiTarget(rawTarget: string): Promise<void> {
  const { target, section } = splitWikiTarget(rawTarget)
  const resolved = resolveTarget(target, notesMap())

  if (resolved !== null) {
    let line: number | null = null
    if (section) line = sectionLine(vaultIndex.getNote(resolved), section)
    await openNoteInLiveEditor(uriForRel(resolved), line ?? undefined)
    return
  }

  const clean = normalizeRel(target)
  const created = await vault.createFile(clean.endsWith('.md') ? clean : clean + '.md', '')
  await vaultIndex.indexFile(created)
  await openNoteInLiveEditor(uriForRel(created))
}

export function registerWikiLinks(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      { language: 'markdown', scheme: 'file' },
      new WikiLinkProvider()
    ),
    vscode.commands.registerCommand('knote.openWikiLink', (rawTarget: string) =>
      openWikiTarget(rawTarget)
    )
  )
}
