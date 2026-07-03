import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { getActiveEditorView } from './activeView'
import { insertTag, setDueDate, setPriority } from '@/taskMeta'

/**
 * Toggle an inline markdown wrapper (**bold**, *italic*, ~~strike~~, `code`)
 * around each selection range. Empty selections expand to the word at the
 * cursor. Already-wrapped text is unwrapped.
 */
export function toggleInline(view: EditorView, marker: string): boolean {
  const len = marker.length
  const spec = view.state.changeByRange((range) => {
    let { from, to } = range
    const doc = view.state.doc
    if (from === to) {
      const word = view.state.wordAt(from)
      if (word) {
        from = word.from
        to = word.to
      }
    }
    const before = doc.sliceString(Math.max(0, from - len), from)
    const after = doc.sliceString(to, Math.min(doc.length, to + len))
    const inner = doc.sliceString(from, to)

    // For single-* italic, don't mistake the tail of a ** bold marker
    const beforeIsMarker =
      before === marker &&
      (marker !== '*' || doc.sliceString(Math.max(0, from - 2), from - 1) !== '*')
    const afterIsMarker =
      after === marker &&
      (marker !== '*' || doc.sliceString(to + 1, Math.min(doc.length, to + 2)) !== '*')

    if (beforeIsMarker && afterIsMarker) {
      // unwrap markers that sit just outside the selection
      return {
        changes: [
          { from: from - len, to: from },
          { from: to, to: to + len }
        ],
        range: EditorSelection.range(from - len, to - len)
      }
    }
    if (inner.startsWith(marker) && inner.endsWith(marker) && inner.length >= 2 * len) {
      // unwrap markers included in the selection
      return {
        changes: [
          { from, to: from + len },
          { from: to - len, to }
        ],
        range: EditorSelection.range(from, to - 2 * len)
      }
    }
    return {
      changes: [
        { from, insert: marker },
        { from: to, insert: marker }
      ],
      range: EditorSelection.range(from + len, to + len)
    }
  })
  view.dispatch(view.state.update(spec, { userEvent: 'input.format', scrollIntoView: true }))
  view.focus()
  return true
}

export const toggleBold = (view: EditorView): boolean => toggleInline(view, '**')
export const toggleItalic = (view: EditorView): boolean => toggleInline(view, '*')
export const toggleStrikethrough = (view: EditorView): boolean => toggleInline(view, '~~')
export const toggleInlineCode = (view: EditorView): boolean => toggleInline(view, '`')

/** Variants usable from the toolbar/palette (act on the active editor). */
export function formatActive(kind: 'bold' | 'italic' | 'strike' | 'code'): void {
  const view = getActiveEditorView()
  if (!view) return
  if (kind === 'bold') toggleBold(view)
  else if (kind === 'italic') toggleItalic(view)
  else if (kind === 'strike') toggleStrikethrough(view)
  else toggleInlineCode(view)
}

/** Rewrite the line the cursor is on and land the cursor at its new end. */
function replaceCurrentLine(view: EditorView, transform: (lineText: string) => string): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const next = transform(line.text)
  if (next === line.text) return
  view.dispatch(
    view.state.update(
      {
        changes: { from: line.from, to: line.to, insert: next },
        selection: EditorSelection.cursor(line.from + next.length)
      },
      { userEvent: 'input.taskMeta', scrollIntoView: true }
    )
  )
  view.focus()
}

export function insertTagAtCursor(view: EditorView, tag: string): void {
  replaceCurrentLine(view, (text) => insertTag(text, tag))
}

export function setPriorityAtCursor(view: EditorView, level: 0 | 1 | 2 | 3): void {
  replaceCurrentLine(view, (text) => setPriority(text, level))
}

export function setDueDateAtCursor(view: EditorView, date: string | null): void {
  replaceCurrentLine(view, (text) => setDueDate(text, date))
}

/** Variants usable from the toolbar (act on the active editor). */
export function insertTagOnActive(tag: string): void {
  const view = getActiveEditorView()
  if (view) insertTagAtCursor(view, tag)
}

export function setPriorityOnActive(level: 0 | 1 | 2 | 3): void {
  const view = getActiveEditorView()
  if (view) setPriorityAtCursor(view, level)
}

export function setDueDateOnActive(date: string | null): void {
  const view = getActiveEditorView()
  if (view) setDueDateAtCursor(view, date)
}
