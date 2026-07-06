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
import { codeFolding, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import { classHighlighter, tags as t } from '@lezer/highlight'
import { TASK_LINE_RE } from '@shared/parser/patterns'
import { livePreviewExtension } from './livePreview/decorations'
import { toggleBold, toggleInlineCode, toggleItalic, toggleStrikethrough } from './formatting'
import { handleImagePaste } from './pasteImage'
import { scanHeadings } from './outlineHeadings'
import { noteCandidates, tagCounts, useIndexStore } from '@/stores/indexStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'

const formatKeymap = [
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-Shift-x', run: toggleStrikethrough },
  { key: 'Mod-`', run: toggleInlineCode }
]

/** [[  →  fuzzy note-title/alias completion (Obsidian's link suggester). */
function wikiLinkCompletions(context: CompletionContext): CompletionResult | null {
  const m = context.matchBefore(/\[\[([^[\]]*)$/)
  if (!m) return null
  const candidates = noteCandidates(useIndexStore.getState().notes)
  return {
    from: m.from + 2,
    options: candidates.map((c) => ({
      label: c.alias ?? c.title,
      detail: c.alias ? `→ ${c.title}` : c.path,
      type: 'text',
      apply: (c.alias ? `${c.title}|${c.alias}` : c.title) + ']]'
    })),
    validFor: /^[^[\]]*$/
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
  return {
    from: m.from + 1,
    options: [...counts.entries()].map(([tag, count]) => ({
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
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(mdHighlight),
    syntaxHighlighting(classHighlighter),
    highlightSelectionMatches(),
    autocompletion({ override: [wikiLinkCompletions, tagCompletions], icons: false }),
    EditorView.domEventHandlers({ paste: handleImagePaste }),
    keymap.of([
      ...formatKeymap,
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
