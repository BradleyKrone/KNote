// Right-click menu actions for the live-preview editor. Each edits the
// CodeMirror document directly via view.dispatch — the CM doc is this editor's
// source of truth and syncs out to the TextDocument (see setupEditor.ts's
// outboundSync), so there's no host round-trip or KNOTE_STALE to handle here.
// The pure line-builders are split out for unit testing. (Checkbox status
// changes live in knoteConstructs.ts's setCheckboxStatus instead, because they
// also drive the reason prompt and Status-Changed meta lines via the host.)

import dayjs from 'dayjs'
import { EditorSelection, type Line } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { machineEntryTemplate } from '@shared/machineEntry'
import { DUE_RE, MACHINE_ENTRY_RE } from '@shared/parser/patterns'
import { insertTag, setDueDate, setPriority } from '../shared/taskMeta'

// ---------- Pure line builders (unit-tested) ----------

/** The 🚜 entry line for a new machine work-log entry (no detail template). */
export function buildMachineEntryLine(serial: string, date: string, tags: string[]): string {
  const tagStr = tags.length ? ' ' + tags.map((t) => `#${t}`).join(' ') : ''
  return `🚜 ${serial}${tagStr} 📅 ${date}`
}

/** Rewrite a machine line's serial + date, leaving inline tags/activity text intact. */
export function editMachineLine(rawLine: string, serial: string, date: string | null): string {
  const m = MACHINE_ENTRY_RE.exec(rawLine)
  if (!m) return rawLine
  const rest = setDueDate(m[2], date)
  return rest ? `🚜 ${serial} ${rest}` : `🚜 ${serial}`
}

/** The current 📅 / @due date on a line, or null. */
export function lineDue(text: string): string | null {
  const m = DUE_RE.exec(text)
  return m ? (m[1] ?? m[2]) : null
}

// ---------- View helpers ----------

/** The document line under the caret. */
export function caretLine(view: EditorView): Line {
  return view.state.doc.lineAt(view.state.selection.main.head)
}

/** Replace the caret line's text (no-op if unchanged), caret left at line end. */
function rewriteCaretLine(view: EditorView, newText: string): void {
  const line = caretLine(view)
  if (newText === line.text) return
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: newText },
    selection: EditorSelection.cursor(line.from + newText.length)
  })
  view.focus()
}

/**
 * Insert a block at the caret, adding a leading/trailing newline when the caret
 * sits mid-line (mirrors the native insert commands). `select` gives offsets,
 * relative to `text`, to select/place the caret within the inserted block.
 */
function insertBlock(view: EditorView, text: string, select?: { from: number; to: number }): void {
  const { head } = view.state.selection.main
  const line = view.state.doc.lineAt(head)
  const lead = head > line.from ? '\n' : ''
  const trail = head < line.to ? '\n' : ''
  const base = head + lead.length
  const selection = select
    ? EditorSelection.range(base + select.from, base + select.to)
    : EditorSelection.cursor(base + text.length)
  view.dispatch({ changes: { from: head, insert: `${lead}${text}${trail}` }, selection })
  view.focus()
}

// ---------- Menu actions ----------

/** Insert a fresh `- [ ] ` checkbox line at the caret. */
export function insertCheckbox(view: EditorView): void {
  insertBlock(view, '- [ ] ')
}

/** Insert a 🏁 milestone line at the caret, with the placeholder label selected. */
export function insertMilestone(view: EditorView): void {
  const label = 'Milestone'
  const text = `🏁 ${label} 📅 ${dayjs().format('YYYY-MM-DD')}`
  const from = '🏁 '.length
  insertBlock(view, text, { from, to: from + label.length })
}

/**
 * Insert a 🚜 machine work-log entry (with any registered tags) plus the blank
 * detail template at the caret, caret left on the entry line ready for the
 * activity text.
 */
export function insertMachineEntry(
  view: EditorView,
  serial: string,
  date: string,
  tags: string[]
): void {
  const entry = buildMachineEntryLine(serial, date, tags)
  const caret = entry.length + 1 // after the trailing space, before the template
  insertBlock(view, `${entry} ${machineEntryTemplate()}`, { from: caret, to: caret })
}

/** Insert a `[[]]` wiki link at the caret (wrapping the selection when there is one). */
export function insertWikiLink(view: EditorView): void {
  const tr = view.state.changeByRange((range) => ({
    changes: [
      { from: range.from, insert: '[[' },
      { from: range.to, insert: ']]' }
    ],
    range: range.empty
      ? EditorSelection.cursor(range.from + 2)
      : EditorSelection.cursor(range.to + 4)
  }))
  view.dispatch(tr)
  view.focus()
}

/** Set (or clear, when null) the 📅 due date on the caret line. */
export function setLineDue(view: EditorView, date: string | null): void {
  rewriteCaretLine(view, setDueDate(caretLine(view).text, date))
}

/** Set the priority marker (0 = none, 1-3 = !/!!/!!!) on the caret line. */
export function setLinePriority(view: EditorView, level: 0 | 1 | 2 | 3): void {
  rewriteCaretLine(view, setPriority(caretLine(view).text, level))
}

/** Append a `#tag` to the caret line. */
export function addLineTag(view: EditorView, tag: string): void {
  rewriteCaretLine(view, insertTag(caretLine(view).text, tag))
}

/** Rewrite the caret machine line's serial + date, preserving inline tags/text. */
export function editMachineOnLine(view: EditorView, serial: string, date: string | null): void {
  rewriteCaretLine(view, editMachineLine(caretLine(view).text, serial, date))
}
