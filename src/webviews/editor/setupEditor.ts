// Builds the CodeMirror 6 EditorView for the live-preview note editor.
//
// Phase 1: a plain markdown source editor with full two-way sync. It keeps NO
// undo history of its own — VS Code owns the TextDocument's undo/redo stack
// (Ctrl+Z is left unbound here so it reaches the host). Live-preview
// rendering (livePreview.ts) and KNote widgets (knoteConstructs.ts) are added
// on top in later phases.

import { Compartment, EditorState, Prec, type Extension, type Text } from '@codemirror/state'
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentUnit, syntaxHighlighting } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { Strikethrough, Table, Autolink } from '@lezer/markdown'
import { codeLanguageFor } from './codeLanguages'
import { search, searchKeymap } from '@codemirror/search'
import { completionKeymap } from '@codemirror/autocomplete'
import type { CmEdit, CmPos } from '@shared/editorSync'
import { vscodeApi } from '../shared/rpc'
import { knoteTheme, knoteTooltipTheme, knoteHighlightStyle } from './theme'
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
import { foldPersistence } from './foldPersist'
import { taskEnterKeymap } from './taskEnter'
import { listContinueTightKeymap } from './listContinueTight'
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
  /**
   * `VaultConfig.tabSize` — default 4. Drives both the display width of a
   * literal Tab character already in the document, and how many spaces
   * Tab/Shift-Tab (indentMore/indentLess) add or remove from a line, since
   * KNote-authored indentation is spaces, not literal tabs.
   */
  tabSize?: number
  /** Appended last — what the embedding view adds for itself (the task dialog's Mod-Enter save). */
  extensions?: Extension[]
}

/**
 * Wraps both facets `VaultConfig.tabSize` drives, so a config-panel change can
 * be pushed into an already-open view (setTabSize) instead of only taking
 * effect for editors created after the change:
 *  - `EditorState.tabSize` — the display width of a literal `\t` already in
 *    the document (rare; KNote-authored indentation is always spaces).
 *  - `indentUnit` — what Tab/Shift-Tab (bound to indentMore/indentLess via
 *    `indentWithTab` below) actually insert or remove a line's leading
 *    whitespace by. This is the one that makes the setting visible day to
 *    day, since typed indentation is spaces, not tabs.
 */
const tabSizeCompartment = new Compartment()

function tabSizeExtensions(tabSize: number): Extension {
  return [EditorState.tabSize.of(tabSize), indentUnit.of(' '.repeat(tabSize))]
}

function tabSizeEffect(tabSize: number) {
  return tabSizeCompartment.reconfigure(tabSizeExtensions(tabSize))
}

export function setTabSize(view: EditorView, tabSize: number): void {
  view.dispatch({ effects: tabSizeEffect(tabSize) })
}

/** Same reconfigure `setTabSize` dispatches into a view, applied to a bare state — lets a test exercise it without a DOM. */
export function withTabSize(state: EditorState, tabSize: number): EditorState {
  return state.update({ effects: tabSizeEffect(tabSize) }).state
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
  return new EditorView({ state: createEditorState(opts), parent: opts.parent })
}

/**
 * Split out from `createEditor` so a test can build the exact same extension
 * stack `createEditor` uses and run CodeMirror commands against it directly —
 * no DOM/EditorView needed for that, and it's the only way to catch a facet
 * (like `indentUnit`) getting silently overridden by some other extension in
 * this list once they're all combined, which testing `indentUnit` in
 * isolation can't.
 */
export function createEditorState(opts: Omit<CreateEditorOptions, 'parent'>): EditorState {
  const kind = opts.kind ?? 'note'
  return EditorState.create({
    doc: opts.doc,
    extensions: [
      editorKind.of(kind),
      tabSizeCompartment.of(tabSizeExtensions(opts.tabSize ?? 4)),
      EditorState.allowMultipleSelections.of(true),
      highlightActiveLine(),
      drawSelection(),
      EditorView.lineWrapping,
      markdown({
        // `remove: ['IndentedCode']`: KNote never authors 4-space indented code
        // blocks (Insert ▸ Code block always fences with ```), but `indentTable`
        // (tableEdit.ts) nests a table under a task by indenting its raw lines
        // with plain spaces — nothing but visual styling, not real block
        // nesting. Without this, a table indented two "Indent table" clicks (4
        // spaces) or more stops parsing as a `Table` node and instead becomes an
        // indented `CodeBlock`, which drops it out of tableRender's rendering
        // and out of readTableCtx's right-click detection (tableEdit.ts) — the
        // Table submenu simply stops appearing.
        extensions: [Strikethrough, Table, Autolink, { remove: ['IndentedCode'] }],
        codeLanguages: codeLanguageFor
      }),
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
      // Must also beat markdown()'s own Enter binding (Prec.high, added by
      // its default addKeymap:true) — see listContinueTight.ts for why.
      Prec.highest(keymap.of(listContinueTightKeymap)),
      keymap.of([...formatKeymap, ...defaultKeymap, ...searchKeymap, indentWithTab]),
      search(),
      knoteTheme,
      knoteTooltipTheme,
      ...(kind === 'note'
        ? [outboundSync, foldPersistence]
        : [history(), keymap.of(historyKeymap)]),
      ...(opts.extensions ?? [])
    ]
  })
}
