// Builds the CodeMirror 6 EditorView for the live-preview note editor.
//
// Phase 1: a plain markdown source editor with full two-way sync. It keeps NO
// undo history of its own — VS Code owns the TextDocument's undo/redo stack
// (Ctrl+Z is left unbound here so it reaches the host). Live-preview
// rendering (livePreview.ts) and KNote widgets (knoteConstructs.ts) are added
// on top in later phases.

import { EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  drawSelection,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter
} from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { Strikethrough, Table, Autolink } from '@lezer/markdown'
import { search, searchKeymap } from '@codemirror/search'
import type { CmEdit } from '@shared/editorSync'
import { vscodeApi } from '../shared/rpc'
import { knoteTheme } from './theme'
import { livePreview } from './livePreview'
import { knoteConstructs } from './knoteConstructs'
import { formatKeymap } from './markdownFormatting'
import { fromHost } from './sync'

// Sends each local edit to the host as minimal offset-based replacements.
const outboundSync = EditorView.updateListener.of((update) => {
  if (!update.docChanged) return
  if (update.transactions.some((t) => t.annotation(fromHost))) return
  const edits: CmEdit[] = []
  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    edits.push({ from: fromA, to: toA, insert: inserted.toString() })
  })
  if (edits.length > 0) vscodeApi.postMessage({ type: 'knote:cm-edits', edits })
})

export function createEditor(opts: { parent: HTMLElement; doc: string; eol: string }): EditorView {
  const state = EditorState.create({
    doc: opts.doc,
    extensions: [
      EditorState.lineSeparator.of(opts.eol),
      EditorState.allowMultipleSelections.of(true),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      EditorView.lineWrapping,
      markdown({ extensions: [Strikethrough, Table, Autolink] }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      livePreview,
      knoteConstructs,
      keymap.of([...formatKeymap, ...defaultKeymap, ...searchKeymap, indentWithTab]),
      search(),
      knoteTheme,
      outboundSync
    ]
  })
  return new EditorView({ state, parent: opts.parent })
}
