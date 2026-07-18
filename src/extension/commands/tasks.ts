// Task commands in the native editor: cycle/set the checkbox status char of
// the cursor line (with require-reason prompts and Status Changed stamping,
// via verifiedEdit so board and disk stay in sync), toggle a checkbox,
// seed a task's attached note, and insert 🏁 milestones.

import * as vscode from 'vscode'
import dayjs from 'dayjs'
import type { BoardColumn } from '@shared/types'
import {
  ARCHIVED_CHAR,
  DATE_ENTERED_RE,
  mergeTaskMetaLines,
  reasonLineForTask,
  statusChangedLineForTask,
  STATUS_CHANGED_UNSET,
  TASK_LINE_RE
} from '@shared/parser/patterns'
import { getVaultConfig } from '../../core/vaultConfig'
import * as verifiedEdit from '../verifiedEdit'
import { vaultNoteRel } from '../paths'

/** A plain list line (`- `, `* `, `1. `) with no checkbox brackets yet. */
const LIST_MARKER_RE = /^(\s*)([-*+]|\d+[.)])\s(.*)$/

function activeVaultEditor(): { editor: vscode.TextEditor; rel: string } | null {
  const editor = vscode.window.activeTextEditor
  if (!editor) return null
  const rel = vaultNoteRel(editor.document)
  if (rel === null) {
    void vscode.window.showWarningMessage('KNote: the active editor is not a vault note.')
    return null
  }
  return { editor, rel }
}

/**
 * Rewrite the cursor line's status char to `column.char`, prompting for a
 * reason when the column requires one and stamping `Status Changed` whenever
 * the char actually changes — one verified edit, same semantics as a board
 * drag.
 */
async function applyStatus(
  editor: vscode.TextEditor,
  rel: string,
  column: BoardColumn
): Promise<void> {
  const lineNo = editor.selection.active.line
  const text = editor.document.lineAt(lineNo).text
  const m = TASK_LINE_RE.exec(text)
  if (!m) {
    void vscode.window.showWarningMessage('KNote: the cursor is not on a task line.')
    return
  }
  if (column.char === m[3]) return

  let reasonLine: string | undefined
  if (column.requireReason) {
    const reason = await vscode.window.showInputBox({
      prompt: `Reason for ${column.name}`,
      placeHolder: 'Why is this task moving here?'
    })
    if (reason === undefined) return // cancelled
    reasonLine = reasonLineForTask(text, column.name, reason.trim(), dayjs().format('YYYY-MM-DD'))
  }
  const statusChangedLine = statusChangedLineForTask(text, dayjs().format('M/D/YYYY'))
  await verifiedEdit.setTaskStatusMeta(rel, lineNo, text, column.char, {
    reasonLine,
    statusChangedLine
  })
}

async function cycleTaskStatus(): Promise<void> {
  const ctx = activeVaultEditor()
  if (!ctx) return
  const text = ctx.editor.document.lineAt(ctx.editor.selection.active.line).text
  const m = TASK_LINE_RE.exec(text)
  if (!m) {
    void vscode.window.showWarningMessage('KNote: the cursor is not on a task line.')
    return
  }
  const columns = (await getVaultConfig()).columns
  const idx = columns.findIndex((c) => c.char === m[3])
  const next = columns[(idx + 1) % columns.length]
  await applyStatus(ctx.editor, ctx.rel, next)
}

async function setTaskStatus(): Promise<void> {
  const ctx = activeVaultEditor()
  if (!ctx) return
  const columns = (await getVaultConfig()).columns
  const picked = await vscode.window.showQuickPick(
    [
      ...columns.map((c) => ({ label: c.name, description: `[${c.char}]`, column: c })),
      {
        label: 'Archive',
        description: `[${ARCHIVED_CHAR}] — keep in the note, remove from the board`,
        column: { name: 'Archive', char: ARCHIVED_CHAR } as BoardColumn
      }
    ],
    { placeHolder: 'Move task to…' }
  )
  if (!picked) return
  await applyStatus(ctx.editor, ctx.rel, picked.column)
}

/**
 * Toggle the current line into/out of a `- [ ]` checkbox. Already-a-task
 * lines are stripped back to a plain bullet; plain list lines get brackets
 * inserted after their marker; anything else is prefixed with `- [ ] `.
 */
async function insertCheckbox(): Promise<void> {
  const ctx = activeVaultEditor()
  if (!ctx) return
  const { editor } = ctx
  const line = editor.document.lineAt(editor.selection.active.line)
  const text = line.text
  let next: string
  const task = TASK_LINE_RE.exec(text)
  const list = LIST_MARKER_RE.exec(text)
  if (task) {
    const [, indent, marker, , rest] = task
    next = `${indent}${marker} ${rest ?? ''}`.trimEnd()
  } else if (list) {
    const [, indent, marker, rest] = list
    next = `${indent}${marker} [ ] ${rest}`
  } else {
    const trimmed = text.trim()
    next = trimmed ? `- [ ] ${trimmed}` : '- [ ] '
  }
  if (next === text) return
  await editor.edit((b) => b.replace(line.range, next))
  const end = new vscode.Position(line.lineNumber, next.length)
  editor.selection = new vscode.Selection(end, end)
}

/**
 * Seed (or extend) the indented note under the top-level task at the cursor:
 * on a fresh task, a `- Status Changed: n/a` + `- Date Entered: <today>` +
 * `- Notes: ` template; on an already-seeded task, one more plain note line.
 * (The Electron app ran this on Enter; here it's an explicit command.)
 */
async function insertTaskNote(): Promise<void> {
  const ctx = activeVaultEditor()
  if (!ctx) return
  const { editor } = ctx
  const doc = editor.document
  const lineNo = editor.selection.active.line
  const line = doc.lineAt(lineNo)
  const task = TASK_LINE_RE.exec(line.text)
  if (!task || task[1].length > 0) {
    void vscode.window.showWarningMessage('KNote: put the cursor on a top-level task line first.')
    return
  }
  const childIndent = task[1] + '  '

  // Skip past any Reason/Status lines already sitting right under the task
  const peek: string[] = []
  for (let i = 1; i <= 2 && lineNo + i < doc.lineCount; i++) {
    peek.push(doc.lineAt(lineNo + i).text)
  }
  const metaLen = mergeTaskMetaLines(peek, {}).consumed
  const anchorLine = doc.lineAt(lineNo + metaLen)

  const next = lineNo + metaLen + 1 < doc.lineCount ? doc.lineAt(lineNo + metaLen + 1) : null
  const alreadySeeded = next !== null && DATE_ENTERED_RE.test(next.text)

  const statusSeed =
    metaLen === 0 ? `${childIndent}- Status Changed: ${STATUS_CHANGED_UNSET}\n` : ''
  const insert = alreadySeeded
    ? '\n' + childIndent
    : `\n${statusSeed}${childIndent}- Date Entered: ${dayjs().format('M/D/YYYY')}\n${childIndent}- Notes: `
  await editor.edit((b) => b.insert(anchorLine.range.end, insert))
  const insertedLines = insert.split('\n')
  const caretLine = anchorLine.lineNumber + insertedLines.length - 1
  const caret = new vscode.Position(caretLine, insertedLines[insertedLines.length - 1].length)
  editor.selection = new vscode.Selection(caret, caret)
}

/** Insert a ready-to-edit 🏁 milestone line at the cursor, with the placeholder label selected. */
async function insertMilestone(important: boolean): Promise<void> {
  const ctx = activeVaultEditor()
  if (!ctx) return
  const { editor } = ctx
  const pos = editor.selection.active
  const line = editor.document.lineAt(pos.line)
  const hasTextBefore = pos.character > 0
  const hasTextAfter = pos.character < line.text.length
  const label = 'Milestone'
  const date = dayjs().format('YYYY-MM-DD')
  const prefix = `${hasTextBefore ? '\n' : ''}🏁 `
  const suffix = ` 📅 ${date}${important ? ' !!!' : ''}${hasTextAfter ? '\n' : ''}`
  await editor.edit((b) => b.insert(pos, prefix + label + suffix))
  const labelLine = pos.line + (hasTextBefore ? 1 : 0)
  const labelCol = (hasTextBefore ? 0 : pos.character) + '🏁 '.length
  editor.selection = new vscode.Selection(labelLine, labelCol, labelLine, labelCol + label.length)
}

export function registerTaskCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('knote.cycleTaskStatus', cycleTaskStatus),
    vscode.commands.registerCommand('knote.setTaskStatus', setTaskStatus),
    vscode.commands.registerCommand('knote.insertCheckbox', insertCheckbox),
    vscode.commands.registerCommand('knote.insertTaskNote', insertTaskNote),
    vscode.commands.registerCommand('knote.insertMilestone', () => insertMilestone(false)),
    vscode.commands.registerCommand('knote.insertMilestoneImportant', () => insertMilestone(true))
  )
}
