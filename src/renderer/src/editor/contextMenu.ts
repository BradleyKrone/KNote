// Builds the editor's right-click menu entries: spelling suggestions (from
// the main-process spellcheck event), formatting/insert actions, task/
// milestone extras, and the checkbox quick status switch. Pure functions —
// EditorPane owns the menu state and pairs these with <ContextMenu>.

import { EditorView } from '@codemirror/view'
import type { BoardColumn } from '@shared/types'
import { ARCHIVED_CHAR, reasonLineForTask, TASK_LINE_RE } from '@shared/parser/patterns'
import { promptReason } from '@/stores/reasonPromptStore'
import type { MenuEntry } from '@/components/ContextMenu'
import { getActiveEditorView } from './activeView'
import {
  adjustFontSize,
  insertCheckboxAtCursor,
  insertMilestoneAtCursor,
  setTaskStatusAtCursor,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleStrikethrough
} from './formatting'

export type PickerKind = 'tag' | 'priority' | 'date' | 'machine'

export interface ContextMenuState {
  x: number
  y: number
  isTask: boolean
  isMilestone: boolean
  isCheckbox: boolean
  spelling: SpellingTarget | null
}

export interface SpellingTarget {
  word: string
  from: number
  to: number
  suggestions: string[]
}

const WORD_CHAR_RE = /[A-Za-z']/

/** Finds the word (if any) touching `pos`, for spellcheck suggestions on right-click. */
export function wordAt(
  view: EditorView,
  pos: number
): { word: string; from: number; to: number } | null {
  const line = view.state.doc.lineAt(pos)
  const offset = pos - line.from
  if (!WORD_CHAR_RE.test(line.text[offset] ?? '') && !WORD_CHAR_RE.test(line.text[offset - 1] ?? '')) {
    return null
  }
  let start = offset
  while (start > 0 && WORD_CHAR_RE.test(line.text[start - 1])) start--
  let end = offset
  while (end < line.text.length && WORD_CHAR_RE.test(line.text[end])) end++
  if (start === end) return null
  return { word: line.text.slice(start, end), from: line.from + start, to: line.from + end }
}

function replaceWordWith(
  view: EditorView,
  target: { from: number; to: number },
  replacement: string
): void {
  view.dispatch({
    changes: { from: target.from, to: target.to, insert: replacement },
    selection: { anchor: target.from + replacement.length }
  })
  view.focus()
}

/** Spelling-suggestion entries shown above the regular formatting menu. */
function buildSpellingMenuItems(view: EditorView, target: SpellingTarget): MenuEntry[] {
  const items: MenuEntry[] = target.suggestions.slice(0, 5).map((s) => ({
    label: s,
    onClick: () => replaceWordWith(view, target, s)
  }))
  if (items.length === 0) items.push({ label: 'No suggestions', onClick: () => {} })
  items.push({
    label: 'Add to dictionary',
    onClick: () => void window.knote.spellcheck.addWord(target.word)
  })
  items.push({ separator: true })
  return items
}

/** Right-click landed on a task's checkbox glyph: offer a quick status switch instead of formatting. */
export function buildCheckboxMenuItems(view: EditorView, columns: BoardColumn[]): MenuEntry[] {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const currentChar = TASK_LINE_RE.exec(line.text)?.[3] ?? null
  const items: MenuEntry[] = columns.map((col) => ({
    label: col.char === currentChar ? `✓ ${col.name}` : col.name,
    onClick: () => {
      if (col.char === currentChar) return
      if (!col.requireReason) {
        setTaskStatusAtCursor(view, col.char)
        return
      }
      void promptReason(col.name).then((result) => {
        if (!result) return
        const target = getActiveEditorView() ?? view
        const taskLine = target.state.doc.lineAt(target.state.selection.main.head).text
        setTaskStatusAtCursor(
          target,
          col.char,
          reasonLineForTask(taskLine, col.name, result.reason, result.date)
        )
      })
    }
  }))
  items.push(
    { separator: true },
    {
      label: currentChar === ARCHIVED_CHAR ? '✓ Archived' : 'Archived',
      onClick: () => setTaskStatusAtCursor(view, ARCHIVED_CHAR)
    }
  )
  return items
}

export function buildContextMenuItems(
  view: EditorView,
  ctx: ContextMenuState,
  openPicker: (kind: PickerKind) => void
): MenuEntry[] {
  const items: MenuEntry[] = ctx.spelling ? buildSpellingMenuItems(view, ctx.spelling) : []
  items.push(
    { label: 'Bold', onClick: () => toggleBold(view) },
    { label: 'Italic', onClick: () => toggleItalic(view) },
    { label: 'Strikethrough', onClick: () => toggleStrikethrough(view) },
    { label: 'Inline code', onClick: () => toggleInlineCode(view) },
    { separator: true },
    { label: 'Add checkbox', onClick: () => insertCheckboxAtCursor(view) },
    { label: 'Add milestone', onClick: () => insertMilestoneAtCursor(false) },
    { label: 'Log machine work…', onClick: () => openPicker('machine') }
  )
  if (ctx.isTask || ctx.isMilestone) {
    items.push(
      { separator: true },
      { label: 'Add tag…', onClick: () => openPicker('tag') },
      { label: 'Set priority…', onClick: () => openPicker('priority') },
      { label: 'Set due date…', onClick: () => openPicker('date') }
    )
  }
  items.push(
    { separator: true },
    { label: 'Increase font size', onClick: () => adjustFontSize(view, 1) },
    { label: 'Decrease font size', onClick: () => adjustFontSize(view, -1) }
  )
  return items
}
