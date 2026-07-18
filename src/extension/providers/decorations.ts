// Modest in-editor decorations for KNote syntax: #tag pills, !!! priority
// markers, 🏁 milestone lines, and dimmed task-meta lines (Reason for /
// Status Changed / Date Entered). Toggleable via knote.decorations.enabled.

import * as vscode from 'vscode'
import {
  DATE_ENTERED_RE,
  MILESTONE_LINE_RE,
  PRIORITY_RE,
  REASON_FOR_RE,
  STATUS_CHANGED_RE,
  TAG_RE
} from '@shared/parser/patterns'
import { vaultNoteRel } from '../paths'

const tagType = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor('badge.background'),
  color: new vscode.ThemeColor('badge.foreground'),
  borderRadius: '3px'
})

const priorityType = vscode.window.createTextEditorDecorationType({
  color: new vscode.ThemeColor('errorForeground'),
  fontWeight: 'bold'
})

const milestoneType = vscode.window.createTextEditorDecorationType({
  fontWeight: 'bold'
})

const metaDimType = vscode.window.createTextEditorDecorationType({
  opacity: '0.55'
})

function enabled(): boolean {
  return vscode.workspace.getConfiguration('knote').get<boolean>('decorations.enabled', true)
}

function refresh(editor: vscode.TextEditor): void {
  if (vaultNoteRel(editor.document) === null || !enabled()) {
    editor.setDecorations(tagType, [])
    editor.setDecorations(priorityType, [])
    editor.setDecorations(milestoneType, [])
    editor.setDecorations(metaDimType, [])
    return
  }

  const tags: vscode.Range[] = []
  const priorities: vscode.Range[] = []
  const milestones: vscode.Range[] = []
  const metas: vscode.Range[] = []

  const doc = editor.document
  let inFence = false
  let inFrontmatter = false
  for (let i = 0; i < doc.lineCount; i++) {
    const text = doc.lineAt(i).text
    if (i === 0 && text.trim() === '---') {
      inFrontmatter = true
      continue
    }
    if (inFrontmatter) {
      if (text.trim() === '---') inFrontmatter = false
      continue
    }
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    TAG_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TAG_RE.exec(text)) !== null) {
      if (/^\d+$/.test(m[2])) continue // purely numeric — not a tag
      const start = m.index + m[1].length
      tags.push(new vscode.Range(i, start, i, start + 1 + m[2].length))
    }

    const p = PRIORITY_RE.exec(text)
    if (p && p.index !== undefined) {
      const start = p.index + (p[0].length - p[1].length)
      priorities.push(new vscode.Range(i, start, i, start + p[1].length))
    }

    if (MILESTONE_LINE_RE.test(text)) {
      milestones.push(new vscode.Range(i, 0, i, text.length))
    }
    if (REASON_FOR_RE.test(text) || STATUS_CHANGED_RE.test(text) || DATE_ENTERED_RE.test(text)) {
      metas.push(new vscode.Range(i, 0, i, text.length))
    }
  }

  editor.setDecorations(tagType, tags)
  editor.setDecorations(priorityType, priorities)
  editor.setDecorations(milestoneType, milestones)
  editor.setDecorations(metaDimType, metas)
}

export function registerDecorations(context: vscode.ExtensionContext): void {
  let timer: NodeJS.Timeout | undefined

  const refreshVisible = (): void => {
    for (const editor of vscode.window.visibleTextEditors) refresh(editor)
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) refresh(editor)
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const editor = vscode.window.visibleTextEditors.find((ed) => ed.document === e.document)
      if (!editor) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => refresh(editor), 300)
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('knote.decorations.enabled')) refreshVisible()
    }),
    tagType,
    priorityType,
    milestoneType,
    metaDimType,
    { dispose: () => timer && clearTimeout(timer) }
  )

  refreshVisible()
}
