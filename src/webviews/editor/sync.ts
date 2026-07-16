// CodeMirror ↔ host document sync glue. Outbound edits are sent by the
// updateListener in setupEditor.ts; this module handles inbound host updates
// and defines the annotation that tells the two apart.

import type { EditorView } from '@codemirror/view'
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
  })
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
