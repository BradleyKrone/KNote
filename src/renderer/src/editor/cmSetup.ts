// Assembles the CodeMirror 6 editor: extensions, keymaps, markdown language,
// autocomplete, and the live-preview compartment toggled by the mode switch.

import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  rectangularSelection
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import {
  codeFolding,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  moveCompletionSelection,
  startCompletion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import { classHighlighter, tags as t } from '@lezer/highlight'
import { TASK_LINE_RE } from '@shared/parser/patterns'
import { livePreviewExtension } from './livePreview/decorations'
import {
  insertTaskNoteLine,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleStrikethrough
} from './formatting'
import { handleImagePaste } from './pasteImage'
import { scanHeadings } from './outlineHeadings'
import { noteCandidates, resolveTarget, tagCounts, useIndexStore } from '@/stores/indexStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useSettingsStore } from '@/stores/settingsStore'

const formatKeymap = [
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-Shift-x', run: toggleStrikethrough },
  { key: 'Mod-`', run: toggleInlineCode }
]

// @codemirror/autocomplete ships no key bindings of its own — without these, the
// [[link and #tag suggestion popups only accept a choice via mouse click. Tab/Shift-Tab
// cycle the highlighted suggestion (mirroring the tag picker popover) and fall through
// to indentWithTab when no popup is open, since these commands return false then.
const linkTagCompletionKeymap = [
  { key: 'Tab', run: moveCompletionSelection(true) },
  { key: 'Shift-Tab', run: moveCompletionSelection(false) },
  { key: 'ArrowDown', run: moveCompletionSelection(true) },
  { key: 'ArrowUp', run: moveCompletionSelection(false) },
  { key: 'PageDown', run: moveCompletionSelection(true, 'page') },
  { key: 'PageUp', run: moveCompletionSelection(false, 'page') },
  { key: 'Enter', run: acceptCompletion },
  { key: 'Escape', run: closeCompletion },
  { key: 'Ctrl-Space', run: startCompletion }
]

// Enter on a task line starts an indented note underneath it rather than a
// new sibling task — must come before defaultKeymap/markdownKeymap's own
// Enter continuation, and after the completion popup's Enter (which only
// fires while a popup is open, and otherwise falls through).
const taskEnterKeymap = [{ key: 'Enter', run: insertTaskNoteLine }]

const WIKI_HEADING_PREFIX_RE = /\[\[([^[\]|#\n]+)#([^[\]|\n]*)$/
// matchBefore searches within a lookback window, so it must stay unanchored (see
// wikiLinkCompletions/tagCompletions below); anchor separately when re-parsing the match.
const WIKI_HEADING_PREFIX_ANCHORED_RE = /^\[\[([^[\]|#\n]+)#([^[\]|\n]*)$/

/** [[Note#  →  fuzzy heading completion, once a resolvable note precedes the #. */
function wikiHeadingCompletions(context: CompletionContext): CompletionResult | null {
  const m = context.matchBefore(WIKI_HEADING_PREFIX_RE)
  if (!m) return null
  const match = WIKI_HEADING_PREFIX_ANCHORED_RE.exec(m.text)
  if (!match) return null
  const [, notePart, headingQuery] = match
  const resolved = resolveTarget(notePart.trim())
  if (!resolved) return null
  const meta = useIndexStore.getState().notes.get(resolved)
  if (!meta || meta.headings.length === 0) return null
  return {
    from: m.to - headingQuery.length,
    options: meta.headings.map((h) => ({
      label: h.text,
      detail: `H${h.level}`,
      type: 'text',
      apply: h.text + ']]'
    })),
    validFor: /^[^[\]|\n]*$/
  }
}

/** [[  →  fuzzy note-title/alias completion (Obsidian's link suggester). */
function wikiLinkCompletions(context: CompletionContext): CompletionResult | null {
  const m = context.matchBefore(/\[\[([^[\]#]*)$/)
  if (!m) return null
  const candidates = noteCandidates(useIndexStore.getState().notes)
  return {
    from: m.from + 2,
    options: candidates.map((c) => ({
      label: c.alias ?? c.title,
      detail: c.alias ? `→ ${c.title}` : c.path,
      type: 'text',
      // Land the cursor just before "]]" (not after) so typing "#" immediately
      // continues into wikiHeadingCompletions, matching Obsidian's flow.
      apply: (view, _completion, from, to) => {
        const insert = (c.alias ? `${c.title}|${c.alias}` : c.title) + ']]'
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length - 2 }
        })
      }
    })),
    validFor: /^[^[\]#]*$/
  }
}

/** #  →  existing tag completion. */
function tagCompletions(context: CompletionContext): CompletionResult | null {
  const m = context.matchBefore(/#[\w/-]*$/)
  if (!m) return null
  // Require at least one char after # (typing "# " is usually a heading)
  if (m.to - m.from < 2 && !context.explicit) return null
  const before = context.state.sliceDoc(Math.max(0, m.from - 1), m.from)
  if (before && !/[\s([{]/.test(before)) return null
  const counts = tagCounts(useIndexStore.getState().notes)
  const deprecated = new Set(useSettingsStore.getState().vaultConfig.deprecatedTags)
  return {
    from: m.from + 1,
    options: [...counts.entries()]
      .filter(([tag]) => !deprecated.has(tag))
      .map(([tag, count]) => ({
        label: tag,
        detail: String(count),
        type: 'keyword'
      })),
    validFor: /^[\w/-]*$/
  }
}

/**
 * All styling is class-based so themes are plain CSS (see styles/app.css).
 * classHighlighter additionally emits tok-* classes used to color code
 * inside fenced blocks.
 */
const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, class: 'cm-h1' },
  { tag: t.heading2, class: 'cm-h2' },
  { tag: t.heading3, class: 'cm-h3' },
  { tag: t.heading4, class: 'cm-h4' },
  { tag: t.heading5, class: 'cm-h5' },
  { tag: t.heading6, class: 'cm-h6' },
  { tag: t.strong, class: 'cm-strong' },
  { tag: t.emphasis, class: 'cm-em' },
  { tag: t.strikethrough, class: 'cm-strike' },
  { tag: t.monospace, class: 'cm-inline-code' },
  { tag: t.link, class: 'cm-link' },
  { tag: t.url, class: 'cm-url' },
  { tag: t.quote, class: 'cm-quote' },
  { tag: t.contentSeparator, class: 'cm-hr-text' },
  { tag: t.processingInstruction, class: 'cm-formatting' },
  { tag: t.meta, class: 'cm-formatting' }
])

export interface EditorCallbacks {
  /** Current vault path of the note (may change via rename while open). */
  getPath: () => string
  /** Called on every user-caused document change. */
  onDocChanged: (flushNow: boolean) => void
}

export interface KnoteEditor {
  view: EditorView
  setLivePreview: (enabled: boolean) => void
  destroy: () => void
}

export function createEditor(
  parent: HTMLElement,
  doc: string,
  livePreview: boolean,
  callbacks: EditorCallbacks
): KnoteEditor {
  const livePreviewCompartment = new Compartment()
  const previewExt = livePreviewExtension(callbacks.getPath)

  const extensions: Extension[] = [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    indentOnInput(),
    codeFolding({
      preparePlaceholder: (state, range) => {
        const fromLine = state.doc.lineAt(range.from).number
        const toLine = state.doc.lineAt(range.to).number
        return { lines: toLine - fromLine }
      },
      // The task's own line already shows a fold arrow and is styled as the note
      // box (see NoteFoldToggleWidget/cm-task-notebox-* in livePreview/decorations.ts),
      // so this placeholder is just a small "N lines" hint, not another bordered box.
      placeholderDOM: (_view, onclick, prepared) => {
        const label = document.createElement('span')
        label.className = 'knote-notebox-foldinfo'
        const n = (prepared as { lines: number } | null)?.lines ?? 1
        label.textContent = `${n} ${n === 1 ? 'line' : 'lines'} hidden`
        label.title = 'Expand note'
        label.addEventListener('mousedown', (e) => e.preventDefault())
        label.addEventListener('click', onclick)
        return label
      }
    }),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    // CM6 sets spellcheck="false" by default; opt back into the OS/Chromium spellchecker
    EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on' }),
    // addKeymap: false — markdown() otherwise bundles its own Enter/Backspace
    // keymap at Prec.high, which would run before (and preempt) taskEnterKeymap
    // below no matter where it's placed in our own keymap.of(). We re-add
    // markdownKeymap ourselves at plain precedence so our ordering controls it.
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
    syntaxHighlighting(mdHighlight),
    syntaxHighlighting(classHighlighter),
    highlightSelectionMatches(),
    autocompletion({
      override: [wikiHeadingCompletions, wikiLinkCompletions, tagCompletions],
      icons: false
    }),
    EditorView.domEventHandlers({ paste: handleImagePaste }),
    keymap.of([
      ...formatKeymap,
      ...linkTagCompletionKeymap,
      ...taskEnterKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...markdownKeymap,
      indentWithTab
    ]),
    livePreviewCompartment.of(livePreview ? previewExt : []),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return
      // Any programmatic KNote edit (checkbox toggle, board move, template)
      // flushes the save immediately so the index/board stay snappy
      const flushNow = update.transactions.some((tr) => tr.isUserEvent('input.knote'))
      callbacks.onDocChanged(flushNow)
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged && !update.selectionSet) return
      const line = update.state.doc.lineAt(update.state.selection.main.head)
      useWorkspaceStore.getState().setActiveLineIsTask(TASK_LINE_RE.test(line.text))
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return
      useWorkspaceStore.getState().setOutlineHeadings(scanHeadings(update.state.doc))
    })
  ]

  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions })
  })
  const initialLine = view.state.doc.lineAt(view.state.selection.main.head)
  useWorkspaceStore.getState().setActiveLineIsTask(TASK_LINE_RE.test(initialLine.text))
  useWorkspaceStore.getState().setOutlineHeadings(scanHeadings(view.state.doc))

  return {
    view,
    setLivePreview: (enabled) => {
      view.dispatch({
        effects: livePreviewCompartment.reconfigure(enabled ? previewExt : [])
      })
    },
    destroy: () => view.destroy()
  }
}
