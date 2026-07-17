// Builds the CodeMirror 6 EditorView for the live-preview note editor.
//
// Phase 1: a plain markdown source editor with full two-way sync. It keeps NO
// undo history of its own — VS Code owns the TextDocument's undo/redo stack
// (Ctrl+Z is left unbound here so it reaches the host). Live-preview
// rendering (livePreview.ts) and KNote widgets (knoteConstructs.ts) are added
// on top in later phases.

import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { Strikethrough, Table, Autolink } from '@lezer/markdown'
import { search, searchKeymap } from '@codemirror/search'
import { completionKeymap } from '@codemirror/autocomplete'
import type { CmEdit } from '@shared/editorSync'
import { vscodeApi } from '../shared/rpc'
import { knoteTheme } from './theme'
import { livePreview } from './livePreview'
import { tableRender } from './tableRender'
import { knoteConstructs } from './knoteConstructs'
import { formatKeymap } from './markdownFormatting'
import { taskFold } from './taskFold'
import { taskEnterKeymap } from './taskEnter'
import { knoteAutocomplete } from './completions'
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
      highlightActiveLine(),
      drawSelection(),
      EditorView.lineWrapping,
      markdown({ extensions: [Strikethrough, Table, Autolink] }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      tableRender,
      livePreview,
      knoteConstructs,
      taskFold,
      knoteAutocomplete,
      // Both keymaps run at highest precedence; array order breaks the tie, so
      // completion keys (Enter to accept a #tag/[[link, arrows to navigate,
      // Esc to dismiss) are tried before Enter-to-seed. acceptCompletion is a
      // no-op when no popup is open, so it falls through to task seeding then.
      Prec.highest(keymap.of(completionKeymap)),
      // Enter-to-seed must beat the default Enter (newline), so give it the
      // highest keymap precedence rather than relying on array order.
      Prec.highest(keymap.of(taskEnterKeymap)),
      keymap.of([...formatKeymap, ...defaultKeymap, ...searchKeymap, indentWithTab]),
      search(),
      knoteTheme,
      outboundSync
    ]
  })
  return new EditorView({ state, parent: opts.parent })
}
