// In-editor formatting shortcuts. The extension's package.json keybindings
// (Ctrl+B, …) are gated on `editorTextFocus && editorLangId == markdown`,
// which is false inside a webview, so they'd otherwise leak to VS Code (Ctrl+B
// toggles the sidebar). These CM6 bindings handle them and stop propagation.

import { EditorSelection } from '@codemirror/state'
import type { EditorView, KeyBinding } from '@codemirror/view'

/** Toggle a symmetric inline marker (`**`, `*`, `~~`, `` ` ``) around each selection. */
export function toggleWrap(view: EditorView, mark: string): boolean {
  const changes = view.state.changeByRange((range) => {
    const doc = view.state.doc
    const before = doc.sliceString(Math.max(0, range.from - mark.length), range.from)
    const after = doc.sliceString(range.to, Math.min(doc.length, range.to + mark.length))
    const selected = doc.sliceString(range.from, range.to)

    // Markers just outside the selection → unwrap them.
    if (before === mark && after === mark) {
      return {
        changes: [
          { from: range.from - mark.length, to: range.from, insert: '' },
          { from: range.to, to: range.to + mark.length, insert: '' }
        ],
        range: EditorSelection.range(range.from - mark.length, range.to - mark.length)
      }
    }
    // Markers inside the selection → unwrap them.
    if (
      selected.length >= mark.length * 2 &&
      selected.startsWith(mark) &&
      selected.endsWith(mark)
    ) {
      return {
        changes: [
          { from: range.from, to: range.from + mark.length, insert: '' },
          { from: range.to - mark.length, to: range.to, insert: '' }
        ],
        range: EditorSelection.range(range.from, range.to - mark.length * 2)
      }
    }
    // Otherwise wrap.
    return {
      changes: [
        { from: range.from, insert: mark },
        { from: range.to, insert: mark }
      ],
      range: EditorSelection.range(range.from + mark.length, range.to + mark.length)
    }
  })
  view.dispatch(changes, { scrollIntoView: true, userEvent: 'input.format' })
  return true
}

export const formatKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: (v) => toggleWrap(v, '**') },
  { key: 'Mod-i', run: (v) => toggleWrap(v, '*') },
  { key: 'Mod-Shift-x', run: (v) => toggleWrap(v, '~~') },
  { key: 'Mod-e', run: (v) => toggleWrap(v, '`') }
]
