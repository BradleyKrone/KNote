// Builds the CodeMirror 6 EditorView for the live-preview note editor.
//
// Phase 1: a plain markdown source editor with full two-way sync. It keeps NO
// undo history of its own — VS Code owns the TextDocument's undo/redo stack
// (Ctrl+Z is left unbound here so it reaches the host). Live-preview
// rendering (livePreview.ts) and KNote widgets (knoteConstructs.ts) are added
// on top in later phases.

import { EditorState, Prec, type Extension, type Text } from '@codemirror/state'
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { Strikethrough, Table, Autolink } from '@lezer/markdown'
import { codeLanguageFor } from './codeLanguages'
import { search, searchKeymap } from '@codemirror/search'
import { completionKeymap } from '@codemirror/autocomplete'
import type { CmEdit, CmPos } from '@shared/editorSync'
import { vscodeApi } from '../shared/rpc'
import { knoteTheme, knoteHighlightStyle } from './theme'
import { livePreview } from './livePreview'
import { tableCellEdit } from './tableCellEdit'
import { tableRender } from './tableRender'
import { mermaidRender } from './mermaidRender'
import { embedRender } from './embedRender'
import { knoteConstructs } from './knoteConstructs'
import { editorKind, type EditorKind } from './editorMode'
import { pasteImage } from './pasteImage'
import { formatKeymap } from './markdownFormatting'
import { taskFold } from './taskFold'
import { taskEnterKeymap } from './taskEnter'
import { knoteAutocomplete } from './completions'
import { linkHover } from './linkHover'
import { mdLink } from './mdLink'
import { spellCheck } from './spellcheck/spellCheck'
import { fromHost } from './sync'

/** CodeMirror offset → the line/character position the host speaks in. */
function posAt(doc: Text, offset: number): CmPos {
  const line = doc.lineAt(offset)
  return { line: line.number - 1, ch: offset - line.from }
}

// Sends each local edit to the host as minimal line/character replacements.
// Positions, never offsets: CodeMirror counts a line break as one character
// and VS Code counts `\r\n` as two, so an offset crossing this boundary
// corrupts CRLF notes (see CmPos in @shared/editorSync).
const outboundSync = EditorView.updateListener.of((update) => {
  if (!update.docChanged) return
  if (update.transactions.some((t) => t.annotation(fromHost))) return
  const edits: CmEdit[] = []
  // iterChanges reports fromA/toA against the pre-change document, so they must
  // be resolved against startState.doc — update.state.doc has already moved on.
  const before = update.startState.doc
  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    edits.push({
      from: posAt(before, fromA),
      to: posAt(before, toA),
      // LF: the document is LF internally (see createEditor); the host
      // translates to the note's real EOL when it applies the edit.
      insert: inserted.toString()
    })
  })
  if (edits.length > 0) vscodeApi.postMessage({ type: 'knote:cm-edits', edits })
})

export interface CreateEditorOptions {
  parent: HTMLElement
  doc: string
  /**
   * What this view is showing — see `editorKind`. `'note'` (the default) posts
   * every change to the host as `knote:cm-edits` and keeps no undo history,
   * because VS Code owns the TextDocument's stack. `'fragment'` does neither:
   * nothing but liveEditorProvider handles those messages, and a detached
   * buffer has no TextDocument to undo through, so it gets CodeMirror's own
   * `history()` instead.
   */
  kind?: EditorKind
  /** Appended last — what the embedding view adds for itself (the task dialog's Mod-Enter save). */
  extensions?: Extension[]
}

/**
 * The document is held in LF internally — deliberately no
 * `EditorState.lineSeparator` facet, so CodeMirror splits `\r\n` on the way in
 * and normalizes it away. That keeps CodeMirror offsets identical to offsets
 * into `doc.toString()`, which is what the inbound diff in sync.ts relies on
 * (with a CRLF separator the two disagree and the diff mangles the document).
 * The note's real EOL lives on the host side only, and is reapplied there when
 * an edit is written to the TextDocument.
 */
export function createEditor(opts: CreateEditorOptions): EditorView {
  const kind = opts.kind ?? 'note'
  const state = EditorState.create({
    doc: opts.doc,
    extensions: [
      editorKind.of(kind),
      EditorState.allowMultipleSelections.of(true),
      highlightActiveLine(),
      drawSelection(),
      EditorView.lineWrapping,
      markdown({ extensions: [Strikethrough, Table, Autolink], codeLanguages: codeLanguageFor }),
      syntaxHighlighting(knoteHighlightStyle, { fallback: true }),
      // Before tableRender: its decorations read the active-cell / table-source
      // state fields, and a state field can only read one declared before it.
      tableCellEdit,
      tableRender,
      mermaidRender,
      embedRender,
      livePreview,
      knoteConstructs,
      pasteImage,
      spellCheck,
      taskFold,
      knoteAutocomplete,
      linkHover,
      mdLink,
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
      ...(kind === 'note' ? [outboundSync] : [history(), keymap.of(historyKeymap)]),
      ...(opts.extensions ?? [])
    ]
  })
  return new EditorView({ state, parent: opts.parent })
}
