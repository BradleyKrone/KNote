// The write half of the two-way sync. Every board/webview/command write to a
// note goes through here:
//
//  1. If VS Code has the document loaded (open tab, even dirty), the edit is
//     applied to the live buffer via WorkspaceEdit — using the same
//     locate-by-expected-text semantics as core/lineEdit — so the user sees
//     it land in their editor. If the document was clean before the edit, it
//     is saved right after (a board drag persists to disk like it always
//     did); if it was dirty, the edit stays in the buffer with the user's
//     other unsaved changes.
//  2. Otherwise the edit goes through core/lineEdit's verified atomic disk
//     write, and the index is refreshed from disk.
//
// Both paths refuse with KNOTE_STALE instead of writing when the expected
// line text no longer matches.

import * as vscode from 'vscode'
import type { VaultPath } from '@shared/types'
import { STALE_ERROR } from '@shared/errors'
import { planTaskMetaEdit, TASK_LINE_RE } from '@shared/parser/patterns'
import * as lineEdit from '../core/lineEdit'
import * as vaultIndex from '../core/indexer/vaultIndex'
import { openDocFor } from './paths'

function stale(rel: VaultPath): Error {
  return new Error(`${STALE_ERROR}: line changed in ${rel}`)
}

/** Same rules as core/lineEdit.locateLine: trust lineNo if its text matches, else a unique exact match. */
function locateLine(doc: vscode.TextDocument, lineNo: number, expectedText: string): number {
  if (lineNo >= 0 && lineNo < doc.lineCount && doc.lineAt(lineNo).text === expectedText) {
    return lineNo
  }
  let found = -1
  for (let i = 0; i < doc.lineCount; i++) {
    if (doc.lineAt(i).text === expectedText) {
      if (found !== -1) return -1
      found = i
    }
  }
  return found
}

async function applyAndMaybeSave(doc: vscode.TextDocument, edit: vscode.WorkspaceEdit): Promise<void> {
  const wasClean = !doc.isDirty
  const ok = await vscode.workspace.applyEdit(edit)
  if (!ok) throw new Error(`Edit could not be applied to ${doc.uri.fsPath}`)
  if (wasClean) await doc.save()
}

/** Range covering a whole line including its EOL (or the preceding EOL for the last line). */
function wholeLineRange(doc: vscode.TextDocument, line: number): vscode.Range {
  if (line + 1 < doc.lineCount) {
    return new vscode.Range(line, 0, line + 1, 0)
  }
  const start = line > 0 ? doc.lineAt(line - 1).range.end : new vscode.Position(line, 0)
  return new vscode.Range(start, doc.lineAt(line).range.end)
}

export async function replaceLine(
  rel: VaultPath,
  lineNo: number,
  expectedText: string,
  newText: string
): Promise<void> {
  const doc = openDocFor(rel)
  if (!doc) {
    await lineEdit.replaceLine(rel, lineNo, expectedText, newText)
    void vaultIndex.indexFile(rel)
    return
  }
  const target = locateLine(doc, lineNo, expectedText)
  if (target === -1) throw stale(rel)
  const edit = new vscode.WorkspaceEdit()
  edit.replace(doc.uri, doc.lineAt(target).range, newText)
  await applyAndMaybeSave(doc, edit)
}

export async function setTaskStatusMeta(
  rel: VaultPath,
  lineNo: number,
  expectedText: string,
  targetChar: string,
  meta: { reasonLine?: string; statusChangedLine?: string }
): Promise<void> {
  const doc = openDocFor(rel)
  if (!doc) {
    await lineEdit.setTaskStatusMeta(rel, lineNo, expectedText, targetChar, meta)
    void vaultIndex.indexFile(rel)
    return
  }
  const target = locateLine(doc, lineNo, expectedText)
  if (target === -1) throw stale(rel)
  const m = TASK_LINE_RE.exec(doc.lineAt(target).text)
  if (!m) throw stale(rel)

  const edit = new vscode.WorkspaceEdit()
  const bracketOffset = m[1].length + m[2].length + 2
  edit.replace(doc.uri, new vscode.Range(target, bracketOffset, target, bracketOffset + 1), targetChar)

  // planTaskMetaEdit works on the pre-edit line array; the status-char
  // replacement above touches only the task line itself, which the plan
  // never includes in its splice, so both edits compose safely.
  const lines: string[] = []
  for (let i = 0; i < doc.lineCount; i++) lines.push(doc.lineAt(i).text)
  const plan = planTaskMetaEdit(lines, target, meta)
  if (plan.deleteCount === 0) {
    if (plan.insert.length > 0) {
      edit.insert(doc.uri, doc.lineAt(target).range.end, '\n' + plan.insert.join('\n'))
    }
  } else {
    const first = plan.start
    const last = plan.start + plan.deleteCount - 1
    edit.replace(
      doc.uri,
      new vscode.Range(first, 0, last, doc.lineAt(last).text.length),
      plan.insert.join('\n')
    )
  }
  await applyAndMaybeSave(doc, edit)
}

export async function deleteLine(rel: VaultPath, lineNo: number, expectedText: string): Promise<void> {
  const doc = openDocFor(rel)
  if (!doc) {
    await lineEdit.deleteLine(rel, lineNo, expectedText)
    void vaultIndex.indexFile(rel)
    return
  }
  const target = locateLine(doc, lineNo, expectedText)
  if (target === -1) throw stale(rel)
  const edit = new vscode.WorkspaceEdit()
  edit.delete(doc.uri, wholeLineRange(doc, target))
  await applyAndMaybeSave(doc, edit)
}

export async function moveLine(
  rel: VaultPath,
  fromLine: number,
  expectedText: string,
  beforeLine: number,
  beforeExpectedText: string | null
): Promise<void> {
  const doc = openDocFor(rel)
  if (!doc) {
    await lineEdit.moveLine(rel, fromLine, expectedText, beforeLine, beforeExpectedText)
    void vaultIndex.indexFile(rel)
    return
  }
  const source = locateLine(doc, fromLine, expectedText)
  if (source === -1) throw stale(rel)

  const edit = new vscode.WorkspaceEdit()
  edit.delete(doc.uri, wholeLineRange(doc, source))
  if (beforeLine === -1 || beforeExpectedText === null) {
    const end = doc.lineAt(doc.lineCount - 1).range.end
    const needsNewline = doc.lineAt(doc.lineCount - 1).text !== ''
    edit.insert(doc.uri, end, (needsNewline ? '\n' : '') + expectedText)
  } else {
    const dest = locateLine(doc, beforeLine, beforeExpectedText)
    if (dest === -1) throw stale(rel)
    edit.insert(doc.uri, new vscode.Position(dest, 0), expectedText + '\n')
  }
  await applyAndMaybeSave(doc, edit)
}

export async function appendToNote(rel: VaultPath, text: string): Promise<void> {
  const doc = openDocFor(rel)
  if (!doc) {
    await lineEdit.appendLine(rel, text)
    void vaultIndex.indexFile(rel)
    return
  }
  const lastLine = doc.lineAt(doc.lineCount - 1)
  const edit = new vscode.WorkspaceEdit()
  const prefix = lastLine.text === '' && doc.lineCount === 1 ? '' : lastLine.text === '' ? '' : '\n'
  edit.insert(doc.uri, lastLine.range.end, prefix + text + '\n')
  await applyAndMaybeSave(doc, edit)
}
