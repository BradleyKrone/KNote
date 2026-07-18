// CodeMirror ↔ host document sync glue. Outbound edits are sent by the
// updateListener in setupEditor.ts; this module handles inbound host updates
// and defines the annotation that tells the two apart.

import { EditorView } from '@codemirror/view'
import { Annotation } from '@codemirror/state'
import { diffEdit, isEditorSyncMessage } from '@shared/editorSync'

/**
 * Marks a transaction whose changes originated from the host (an external
 * edit pushed in), so the outbound updateListener doesn't echo it back as a
 * cm-edits message and create a feedback loop.
 */
export const fromHost = Annotation.define<boolean>()

/** Listen for host → webview document updates and reconcile them into CM6. */
export function wireInboundSync(view: EditorView): void {
  window.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as unknown
    if (!isEditorSyncMessage(msg)) return
    if (msg.type === 'knote:host-update') applyHostText(view, msg.text)
    else if (msg.type === 'knote:reveal-line') revealLine(view, msg.line)
  })
}

/**
 * Scroll to a 0-based line and put the cursor at its start, centering it in
 * the viewport. Used to jump to a task when the note is opened from the board.
 */
export function revealLine(view: EditorView, line: number): void {
  const clamped = Math.max(0, Math.min(line, view.state.doc.lines - 1))
  const pos = view.state.doc.line(clamped + 1).from
  view.dispatch({
    selection: { anchor: pos, head: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    scrollIntoView: true
  })
  view.focus()
}

function applyHostText(view: EditorView, text: string): void {
  const current = view.state.doc.toString()
  if (current === text) return

  // Reconcile only the span that actually changed (diffEdit trims the common
  // prefix/suffix) so positions outside it stay fixed and CodeMirror keeps its
  // scroll position. Replacing the whole document (from 0) instead makes the
  // viewport jump to the top, e.g. every time a sub-task checkbox is toggled
  // (the host round-trips the full note text back). The selection is left to
  // map through the change so the caret follows its surrounding text.
  const { from, to, insert } = diffEdit(current, text)
  view.dispatch({
    changes: { from, to, insert },
    annotations: fromHost.of(true)
  })
}
