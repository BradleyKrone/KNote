import dayjs from 'dayjs'
import { EditorSelection, type Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { REASON_FOR_RE, TASK_LINE_RE } from '@shared/parser/patterns'
import { getActiveEditorView } from './activeView'
import { insertTag, setDueDate, setPriority } from '@/taskMeta'

/** A plain list line (`- `, `* `, `1. `) with no checkbox brackets yet. */
const LIST_MARKER_RE = /^(\s*)([-*+]|\d+[.)])\s(.*)$/

/** Mutually-exclusive inline emphasis wrappers, longest first so `**` is
 *  never mistaken for a `*` italic marker. */
const EMPHASIS_MARKERS = ['**', '~~', '*']

/** True when the char(s) at `pos` going backwards are exactly `marker`,
 *  guarding against mistaking the tail of `**` for a lone `*`. */
function markerBefore(doc: Text, pos: number, marker: string): boolean {
  const len = marker.length
  if (doc.sliceString(Math.max(0, pos - len), pos) !== marker) return false
  if (marker !== '*') return true
  return doc.sliceString(Math.max(0, pos - 2), pos - 1) !== '*'
}

/** True when the char(s) at `pos` going forwards are exactly `marker`,
 *  guarding against mistaking the head of `**` for a lone `*`. */
function markerAfter(doc: Text, pos: number, marker: string): boolean {
  const len = marker.length
  if (doc.sliceString(pos, Math.min(doc.length, pos + len)) !== marker) return false
  if (marker !== '*') return true
  return doc.sliceString(pos + 1, Math.min(doc.length, pos + 2)) !== '*'
}

/** True when `inner` is wrapped edge-to-edge by exactly `marker` (not a
 *  longer marker that happens to share a leading/trailing char). */
function innerWrappedBy(inner: string, marker: string): boolean {
  if (inner.length < 2 * marker.length) return false
  if (!inner.startsWith(marker) || !inner.endsWith(marker)) return false
  if (marker === '*' && (inner.startsWith('**') || inner.endsWith('**'))) return false
  return true
}

/**
 * Toggle an inline markdown wrapper (**bold**, *italic*, ~~strike~~, `code`)
 * around each selection range. Empty selections expand to the word at the
 * cursor. Leading/trailing whitespace in the selection is left outside the
 * wrapper. Re-applying the same marker unwraps it; applying a different
 * emphasis marker over an existing one swaps it out instead of stacking.
 */
export function toggleInline(view: EditorView, marker: string): boolean {
  const len = marker.length
  const otherMarkers = EMPHASIS_MARKERS.includes(marker)
    ? EMPHASIS_MARKERS.filter((m) => m !== marker)
    : []
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
    const wholeFrom = from
    const wholeTo = to

    // Hug the markers to the non-whitespace text, keeping any surrounding
    // spaces in the original selection outside the wrapper.
    const raw = doc.sliceString(from, to)
    const leading = raw.length - raw.trimStart().length
    const trailing = raw.length - raw.trimEnd().length
    if (leading + trailing < raw.length) {
      from += leading
      to -= trailing
    }

    const inner = doc.sliceString(from, to)

    if (markerBefore(doc, from, marker) && markerAfter(doc, to, marker)) {
      // unwrap markers that sit just outside the selection
      return {
        changes: [
          { from: from - len, to: from },
          { from: to, to: to + len }
        ],
        range: EditorSelection.range(wholeFrom - len, wholeTo - len)
      }
    }
    if (innerWrappedBy(inner, marker)) {
      // unwrap markers included in the selection
      return {
        changes: [
          { from, to: from + len },
          { from: to - len, to }
        ],
        range: EditorSelection.range(wholeFrom, wholeTo - 2 * len)
      }
    }

    // Already wrapped in a different (mutually-exclusive) emphasis marker?
    // Swap it for this one instead of stacking markers.
    for (const other of otherMarkers) {
      const oLen = other.length
      if (markerBefore(doc, from, other) && markerAfter(doc, to, other)) {
        return {
          changes: [
            { from: from - oLen, to: from, insert: marker },
            { from: to, to: to + oLen, insert: marker }
          ],
          range: EditorSelection.range(wholeFrom - oLen + len, wholeTo - oLen + len)
        }
      }
      if (innerWrappedBy(inner, other)) {
        return {
          changes: [
            { from, to: from + oLen, insert: marker },
            { from: to - oLen, to, insert: marker }
          ],
          range: EditorSelection.range(wholeFrom, wholeTo - 2 * oLen + 2 * len)
        }
      }
    }

    return {
      changes: [
        { from, insert: marker },
        { from: to, insert: marker }
      ],
      range: EditorSelection.range(wholeFrom + len, wholeTo + len)
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

// ---------- Per-selection font size ----------
// Stored as a raw HTML span, e.g. <span style="font-size:20px">text</span>.
// Sizes are kept to exactly two digits (10-36) so the open tag has a fixed
// length, which keeps the wrap/unwrap arithmetic below as simple as the
// emphasis-marker logic above.
const FONT_SIZE_BASE = 16
const FONT_SIZE_STEP = 2
const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 36
const FONT_SIZE_CLOSE = '</span>'
const FONT_SIZE_OPEN_RE = /^<span style="font-size:(\d{2})px">$/
const FONT_SIZE_FULL_RE = /^<span style="font-size:(\d{2})px">([\s\S]*)<\/span>$/
const FONT_SIZE_OPEN_LEN = `<span style="font-size:${FONT_SIZE_MIN}px">`.length

function fontSizeOpenTag(px: number): string {
  return `<span style="font-size:${px}px">`
}

/**
 * Grow/shrink the font size of each selection range by one step, wrapping it
 * in (or rewriting/removing) a `<span style="font-size:...">` tag. Empty
 * selections expand to the word at the cursor; leading/trailing whitespace
 * is left outside the wrapper, matching toggleInline's behavior. Reaching
 * the base size again removes the wrapper entirely.
 */
export function adjustFontSize(view: EditorView, direction: 1 | -1): boolean {
  const step = FONT_SIZE_STEP * direction
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
    const wholeFrom = from
    const wholeTo = to

    const raw = doc.sliceString(from, to)
    const leading = raw.length - raw.trimStart().length
    const trailing = raw.length - raw.trimEnd().length
    if (leading + trailing < raw.length) {
      from += leading
      to -= trailing
    }
    if (from >= to) {
      from = wholeFrom
      to = wholeTo
    }

    let removeFrom = from
    let removeTo = to
    let innerText = doc.sliceString(from, to)
    let currentSize = FONT_SIZE_BASE

    const before = doc.sliceString(Math.max(0, from - FONT_SIZE_OPEN_LEN), from)
    const openMatch = FONT_SIZE_OPEN_RE.exec(before)
    const after = doc.sliceString(to, Math.min(doc.length, to + FONT_SIZE_CLOSE.length))
    if (openMatch && after === FONT_SIZE_CLOSE) {
      currentSize = parseInt(openMatch[1], 10)
      removeFrom = from - FONT_SIZE_OPEN_LEN
      removeTo = to + FONT_SIZE_CLOSE.length
    } else {
      const fullMatch = FONT_SIZE_FULL_RE.exec(innerText)
      if (fullMatch) {
        currentSize = parseInt(fullMatch[1], 10)
        innerText = fullMatch[2]
      }
    }

    const newSize = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, currentSize + step))
    const backToBase = newSize === FONT_SIZE_BASE
    const replacement = backToBase
      ? innerText
      : fontSizeOpenTag(newSize) + innerText + FONT_SIZE_CLOSE
    const innerFrom = removeFrom + (backToBase ? 0 : FONT_SIZE_OPEN_LEN)

    return {
      changes: [{ from: removeFrom, to: removeTo, insert: replacement }],
      range: EditorSelection.range(innerFrom, innerFrom + innerText.length)
    }
  })
  view.dispatch(view.state.update(spec, { userEvent: 'input.format', scrollIntoView: true }))
  view.focus()
  return true
}

/** Variants usable from the toolbar/context menu (act on the active editor). */
export function increaseFontSizeActive(): void {
  const view = getActiveEditorView()
  if (view) adjustFontSize(view, 1)
}

export function decreaseFontSizeActive(): void {
  const view = getActiveEditorView()
  if (view) adjustFontSize(view, -1)
}

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

/**
 * Toggle the current line into/out of a `- [ ]` checkbox. Already-a-task
 * lines are stripped back to a plain bullet; plain list lines get brackets
 * inserted after their marker; anything else is prefixed with `- [ ] `.
 */
export function insertCheckboxAtCursor(view: EditorView): void {
  replaceCurrentLine(view, (text) => {
    const task = TASK_LINE_RE.exec(text)
    if (task) {
      const [, indent, marker, , rest] = task
      return `${indent}${marker} ${rest ?? ''}`.trimEnd()
    }
    const list = LIST_MARKER_RE.exec(text)
    if (list) {
      const [, indent, marker, rest] = list
      return `${indent}${marker} [ ] ${rest}`
    }
    const trimmed = text.trim()
    return trimmed ? `- [ ] ${trimmed}` : '- [ ] '
  })
}

/**
 * Enter on a task line starts an indented note line underneath it (rendered
 * folded as the task's attached note, see `findNoteBlockEnd` in
 * livePreview/decorations.ts) instead of continuing with another `- [ ]`
 * sibling task at the same level — task text is usually short, and further
 * detail belongs in the note, not a new task.
 */
export function insertTaskNoteLine(view: EditorView): boolean {
  const { state } = view
  const range = state.selection.main
  if (!range.empty) return false
  const line = state.doc.lineAt(range.head)
  const task = TASK_LINE_RE.exec(line.text)
  if (!task) return false
  const insert = '\n' + task[1] + '  '
  view.dispatch(
    state.update({
      changes: { from: range.head, insert },
      selection: EditorSelection.cursor(range.head + insert.length),
      userEvent: 'input.knote.taskNote',
      scrollIntoView: true
    })
  )
  return true
}

/** Variant usable from the toolbar/palette (acts on the active editor). */
export function insertCheckboxOnActive(): void {
  const view = getActiveEditorView()
  if (view) insertCheckboxAtCursor(view)
}

/**
 * Rewrite the current line's checkbox status char (Kanban column or
 * archive). `reasonLine`, when given (a `Reason for <Column>: ... 📅 <date>`
 * line for a column that requires one), is inserted directly under the task
 * in the same transaction — replacing an existing reason line there, if any.
 */
export function setTaskStatusAtCursor(view: EditorView, char: string, reasonLine?: string): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const m = TASK_LINE_RE.exec(line.text)
  if (!m) return
  const bracketOffset = m[1].length + m[2].length + 2
  const changes: Array<{ from: number; to?: number; insert: string }> = [
    { from: line.from + bracketOffset, to: line.from + bracketOffset + 1, insert: char }
  ]
  if (reasonLine !== undefined) {
    const doc = view.state.doc
    const nextLine = line.number + 1 <= doc.lines ? doc.line(line.number + 1) : null
    if (nextLine && REASON_FOR_RE.test(nextLine.text)) {
      changes.push({ from: nextLine.from, to: nextLine.to, insert: reasonLine })
    } else {
      changes.push({ from: line.to, insert: '\n' + reasonLine })
    }
  }
  view.dispatch({ changes, userEvent: 'input.knote.toggleTask' })
}

/** Insert a ready-to-edit 🏁 milestone line at the cursor, with the placeholder label selected. */
export function insertMilestoneAtCursor(important: boolean): void {
  const view = getActiveEditorView()
  if (!view) return
  const pos = view.state.selection.main.head
  const line = view.state.doc.lineAt(pos)
  // Split out onto its own line on either side that actually has content —
  // a cursor mid-line (e.g. from a right-click) must not glue the milestone
  // onto whatever text follows it.
  const hasTextBefore = pos > line.from
  const hasTextAfter = pos < line.to
  const label = 'Milestone'
  const date = dayjs().format('YYYY-MM-DD')
  // 🏁 is an astral-plane codepoint (surrogate pair) — derive the offset from the
  // actual prefix length rather than counting characters, so positions stay in sync.
  const prefix = `${hasTextBefore ? '\n' : ''}🏁 `
  const suffix = ` 📅 ${date}${important ? ' !!!' : ''}${hasTextAfter ? '\n' : ''}`
  const insert = prefix + label + suffix
  const labelFrom = pos + prefix.length
  view.dispatch(
    view.state.update({
      changes: { from: pos, insert },
      selection: EditorSelection.range(labelFrom, labelFrom + label.length),
      userEvent: 'input.knote.milestone',
      scrollIntoView: true
    })
  )
  view.focus()
}

/** Detail lines auto-added below every new machine work-log entry, ready
 *  to fill in after the label. */
const MACHINE_ENTRY_TEMPLATE_LABELS = ['Base Machine Software', 'Testing Software', 'Notes']

/**
 * Insert a 🚜 machine work-log entry (`🚜 <serial> #tag… 📅 <date>`) at the
 * cursor, followed by a blank detail template (base machine software, testing
 * software, notes), leaving the caret at the end of the entry line (after the
 * date) so the user immediately types what they did.
 */
export function insertMachineEntryAtCursor(
  view: EditorView,
  serial: string,
  date: string,
  tags: string[] = []
): void {
  const pos = view.state.selection.main.head
  const line = view.state.doc.lineAt(pos)
  // Split onto its own line on either side that has content, so a mid-line
  // cursor never glues the entry onto surrounding text (mirrors milestones).
  const hasTextBefore = pos > line.from
  const hasTextAfter = pos < line.to
  // 🚜 is an astral-plane codepoint (surrogate pair) — use string length (UTF-16
  // code units, which is what CodeMirror positions count) for the caret offset.
  const tagText = tags.length ? ' ' + tags.map((t) => `#${t}`).join(' ') : ''
  const prefix = `${hasTextBefore ? '\n' : ''}🚜 ${serial}${tagText} 📅 ${date} `
  const template = MACHINE_ENTRY_TEMPLATE_LABELS.map((label) => `\n- ${label}: `).join('')
  const suffix = hasTextAfter ? '\n' : ''
  const insert = prefix + template + suffix
  const caret = pos + prefix.length
  view.dispatch(
    view.state.update({
      changes: { from: pos, insert },
      selection: EditorSelection.cursor(caret),
      userEvent: 'input.knote.machine',
      scrollIntoView: true
    })
  )
  view.focus()
}

/** Variant usable from the palette (acts on the active editor, dates today). */
export function insertMachineEntryOnActive(): void {
  const view = getActiveEditorView()
  if (view) insertMachineEntryAtCursor(view, '', dayjs().format('YYYY-MM-DD'))
}
