// Cut / Copy / Paste for the live-preview editor's right-click menu.
//
// Ctrl+X/C/V already work — CodeMirror handles those natively. The menu items
// can't: by the time one is clicked the Popover has taken focus, so
// `document.execCommand` has no editor selection to act on, and
// `navigator.clipboard` is blocked inside a webview. Both directions go
// through the host's `vscode.env.clipboard` instead.
//
// Split from editorActions.ts because importing the RPC bridge runs
// `acquireVsCodeApi()` at module load, which would break the pure-logic unit
// tests that import editorActions directly (the same split taskLink.ts /
// taskLinkLogic.ts and linkHover.ts / hoverLogic.ts already use).

import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { host } from '../shared/rpc'
import { normalizePastedText } from './editorActions'

/** Copy the selection to the clipboard. No-op when nothing is selected. */
export function copySelection(view: EditorView): void {
  const { from, to } = view.state.selection.main
  if (from === to) return
  void host.copyToClipboard(view.state.sliceDoc(from, to))
}

/** Copy the selection to the clipboard and delete it. No-op when nothing is selected. */
export function cutSelection(view: EditorView): void {
  const { from, to } = view.state.selection.main
  if (from === to) return
  void host.copyToClipboard(view.state.sliceDoc(from, to))
  view.dispatch({
    changes: { from, to, insert: '' },
    selection: EditorSelection.cursor(from),
    userEvent: 'delete.cut'
  })
  view.focus()
}

/** Insert the clipboard's text at the caret, replacing the selection when there is one. */
export async function pasteAtSelection(view: EditorView): Promise<void> {
  const text = normalizePastedText(await host.readClipboard(), view.state.lineBreak)
  if (!text) return
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    userEvent: 'input.paste'
  })
  view.focus()
}
