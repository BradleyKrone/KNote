// Whole-frontmatter-block rewrites (the Properties view's write path).
// Same two-path rule as verifiedEdit: live buffer when the note is open,
// verified atomic disk write otherwise.

import * as vscode from 'vscode'
import { stringify as yamlStringify } from 'yaml'
import type { VaultPath } from '@shared/types'
import * as vault from '../core/vaultService'
import * as vaultIndex from '../core/indexer/vaultIndex'
import { openDocFor } from './paths'

/** End line (the closing ---) of a leading frontmatter block, or -1. */
function frontmatterEndLine(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return -1
  for (let i = 1; i < Math.min(lines.length, 200); i++) {
    if (lines[i].trim() === '---') return i
  }
  return -1
}

function buildBlock(frontmatter: Record<string, unknown>): string {
  if (Object.keys(frontmatter).length === 0) return ''
  return `---\n${yamlStringify(frontmatter).trimEnd()}\n---`
}

export async function setFrontmatter(
  rel: VaultPath,
  frontmatter: Record<string, unknown>
): Promise<void> {
  const block = buildBlock(frontmatter)

  const doc = openDocFor(rel)
  if (doc) {
    const lines: string[] = []
    for (let i = 0; i < doc.lineCount; i++) lines.push(doc.lineAt(i).text)
    const end = frontmatterEndLine(lines)
    const edit = new vscode.WorkspaceEdit()
    const insert = block === '' ? '' : block + '\n'
    if (end === -1) {
      edit.insert(doc.uri, new vscode.Position(0, 0), insert)
    } else {
      const replaceEnd =
        end + 1 < doc.lineCount ? new vscode.Position(end + 1, 0) : doc.lineAt(end).range.end
      edit.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), replaceEnd), insert)
    }
    const wasClean = !doc.isDirty
    const ok = await vscode.workspace.applyEdit(edit)
    if (!ok) throw new Error(`Edit could not be applied to ${rel}`)
    if (wasClean) await doc.save()
    return
  }

  const { content, mtimeMs } = await vault.readFile(rel)
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const end = frontmatterEndLine(lines)
  const body = end === -1 ? lines : lines.slice(end + 1)
  const blockLines = block === '' ? [] : block.split('\n')
  const out = [...blockLines, ...body].join(eol)
  await vault.writeFileAtomic(rel, out, mtimeMs)
  void vaultIndex.indexFile(rel)
}
