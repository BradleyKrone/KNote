// CodeMirror ↔ host document sync glue. Outbound edits are sent by the
// updateListener in setupEditor.ts; this module handles inbound host updates
// and defines the annotation that tells the two apart.

import { EditorView } from '@codemirror/view'
import { Annotation } from '@codemirror/state'
import { isEditorSyncMessage } from '@shared/editorSync'

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
  if (view.state.doc.toString() === text) return
  const sel = view.state.selection.main
  const len = text.length
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: Math.min(sel.anchor, len), head: Math.min(sel.head, len) },
    annotations: fromHost.of(true)
  })
}
