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

async function applyAndMaybeSave(
  doc: vscode.TextDocument,
  edit: vscode.WorkspaceEdit
): Promise<void> {
  const wasClean = !doc.isDirty
  const ok = await vscode.workspace.applyEdit(edit)
  if (!ok) throw new Error(`Edit could not be applied to ${doc.uri.fsPath}`)
  if (wasClean) await doc.save()
}

/**
 * Fold a `planTaskMetaEdit` splice into `edit` as a document edit.
 *
 * With `newTaskLineText` the whole thing collapses to a single replace
 * spanning the task line *and* its old block. That isn't just tidier: staging
 * a separate replace for the task line would end at exactly the offset the
 * pure-insert case below starts at, and VS Code makes no promise about how it
 * orders two edits touching the same position. One replace has no such
 * ambiguity, and it stays correct in every shape — no old block (the range is
 * the task line alone), an emptied block (the range swallows it, leaving no
 * blank line behind), or both sides non-empty.
 *
 * Without it, three shapes, and the middle one is why this lives in one place
 * rather than at each call site: a pure insert hangs the new lines off the end
 * of the task line; a plan with nothing left to write has to swallow the
 * *preceding* newline too, or the delete leaves an empty line dangling under
 * the task; anything else is a plain range replace.
 */
function applyBlockPlan(
  doc: vscode.TextDocument,
  edit: vscode.WorkspaceEdit,
  plan: { start: number; deleteCount: number; insert: string[] },
  taskLine: number,
  newTaskLineText?: string
): void {
  if (newTaskLineText !== undefined) {
    const last = plan.deleteCount > 0 ? plan.start + plan.deleteCount - 1 : taskLine
    edit.replace(
      doc.uri,
      new vscode.Range(taskLine, 0, last, doc.lineAt(last).text.length),
      [newTaskLineText, ...plan.insert].join('\n')
    )
    return
  }
  if (plan.deleteCount === 0) {
    if (plan.insert.length > 0) {
      edit.insert(doc.uri, doc.lineAt(taskLine).range.end, '\n' + plan.insert.join('\n'))
    }
    return
  }
  const first = plan.start
  const last = plan.start + plan.deleteCount - 1
  if (plan.insert.length === 0) {
    const prev = first - 1
    edit.delete(
      doc.uri,
      new vscode.Range(prev, doc.lineAt(prev).text.length, last, doc.lineAt(last).text.length)
    )
    return
  }
  edit.replace(
    doc.uri,
    new vscode.Range(first, 0, last, doc.lineAt(last).text.length),
    plan.insert.join('\n')
  )
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
  meta: { reasonLine?: string | null; statusChangedLine?: string }
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
  edit.replace(
    doc.uri,
    new vscode.Range(target, bracketOffset, target, bracketOffset + 1),
    targetChar
  )

  // planTaskMetaEdit works on the pre-edit line array; the status-char
  // replacement above touches only the task line itself, which the plan
  // never includes in its splice, so both edits compose safely.
  const lines: string[] = []
  for (let i = 0; i < doc.lineCount; i++) lines.push(doc.lineAt(i).text)
  applyBlockPlan(doc, edit, planTaskMetaEdit(lines, target, meta), target)
  await applyAndMaybeSave(doc, edit)
}

/**
 * Rewrite a task's line text *and* its attached note body in one verified edit
 * — what the board's task editor saves. One edit rather than two so the whole
 * change is a single undo step, and so a stale note can't reject half of it
 * after the other half has already landed.
 *
 * The auto-managed `Reason for` / `Status Changed` / `Date Entered` lines are
 * not the caller's to send: `planTaskMetaEdit` carries whatever is already
 * there straight through, so the editor can't drop them.
 */
export async function setTaskTextAndNotes(
  rel: VaultPath,
  lineNo: number,
  expectedText: string,
  newLineText: string,
  noteLines: string[]
): Promise<void> {
  const doc = openDocFor(rel)
  if (!doc) {
    await lineEdit.setTaskTextAndNotes(rel, lineNo, expectedText, newLineText, noteLines)
    void vaultIndex.indexFile(rel)
    return
  }
  const target = locateLine(doc, lineNo, expectedText)
  if (target === -1) throw stale(rel)
  if (!TASK_LINE_RE.test(doc.lineAt(target).text)) throw stale(rel)

  // Planned against the pre-edit line array, as in setTaskStatusMeta; the line
  // and its block go in as one replace (see applyBlockPlan).
  const lines: string[] = []
  for (let i = 0; i < doc.lineCount; i++) lines.push(doc.lineAt(i).text)
  const edit = new vscode.WorkspaceEdit()
  applyBlockPlan(doc, edit, planTaskMetaEdit(lines, target, { noteLines }), target, newLineText)
  await applyAndMaybeSave(doc, edit)
}

export async function deleteLine(
  rel: VaultPath,
  lineNo: number,
  expectedText: string
): Promise<void> {
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

export async function insertLine(
  rel: VaultPath,
  afterLine: number,
  afterExpectedText: string,
  text: string
): Promise<void> {
  const doc = openDocFor(rel)
  if (!doc) {
    await lineEdit.insertLine(rel, afterLine, afterExpectedText, text)
    void vaultIndex.indexFile(rel)
    return
  }
  const anchor = locateLine(doc, afterLine, afterExpectedText)
  if (anchor === -1) throw stale(rel)
  const edit = new vscode.WorkspaceEdit()
  edit.insert(doc.uri, doc.lineAt(anchor).range.end, '\n' + text)
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
