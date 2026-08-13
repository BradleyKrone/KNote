// A single-line CodeMirror view for the task dialog's title field. Deliberately
// not the full note editor (`editor/setupEditor.ts`) — no markdown grammar,
// tables, embeds or spell check — just the same #tag/priority styling
// `knoteConstructs.ts` gives a task line in the real editor, so the title here
// reads the same way it does on the card and in a note instead of showing raw
// `#tag`/`!!` markup as plain text.

import { completionKeymap } from '@codemirror/autocomplete'
import { Prec, type Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder,
  tooltips,
  ViewPlugin,
  type ViewUpdate
} from '@codemirror/view'
import { PRIORITY_RE, TAG_RE } from '@shared/parser/patterns'
import { knoteAutocomplete } from '../editor/completions'
import { knoteTooltipTheme } from '../editor/theme'

function buildDecorations(text: string): DecorationSet {
  const decorations: Range<Decoration>[] = []

  TAG_RE.lastIndex = 0
  for (let m = TAG_RE.exec(text); m; m = TAG_RE.exec(text)) {
    const tagName = m[2]
    if (/^\d+$/.test(tagName)) continue // numeric-only isn't a tag (Obsidian rule)
    const from = m.index + m[1].length
    decorations.push(
      Decoration.mark({ class: 'cm-knote-tag' }).range(from, from + 1 + tagName.length)
    )
  }

  const prio = PRIORITY_RE.exec(text)
  if (prio && prio.index !== undefined) {
    const from = prio.index + prio[0].indexOf('!')
    decorations.push(
      Decoration.mark({ class: 'cm-knote-priority' }).range(from, from + prio[1].length)
    )
  }

  return Decoration.set(decorations, true)
}

const decorateTitle = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state.doc.toString())
    }
    update(update: ViewUpdate): void {
      if (update.docChanged) this.decorations = buildDecorations(update.state.doc.toString())
    }
  },
  { decorations: (plugin) => plugin.decorations }
)

const titleTheme = EditorView.theme({
  '.cm-scroller': { fontFamily: 'inherit', fontSize: '13px', overflow: 'auto' },
  '.cm-content': { padding: '4px 8px', caretColor: 'var(--vscode-input-foreground)' },
  '.cm-line': { padding: 0 }
})

export interface TaskTitleEditorOptions {
  parent: HTMLElement
  doc: string
  placeholderText: string
  /** Fired on every keystroke — mirrors the old controlled `<textarea>`'s onChange. */
  onChange: (text: string) => void
  /** A task's text is one line on disk, so Enter submits rather than inserting a newline. */
  onEnter: () => void
}

export function createTaskTitleEditor(opts: TaskTitleEditorOptions): EditorView {
  return new EditorView({
    parent: opts.parent,
    doc: opts.doc,
    extensions: [
      EditorView.lineWrapping,
      placeholder(opts.placeholderText),
      decorateTitle,
      titleTheme,
      // The same VS Code-themed popup colors (and above-the-modal z-index)
      // the note editor's autocomplete uses, so it reads the same here.
      knoteTooltipTheme,
      // `.task-note-line` doesn't clip overflow, but the modal's own panel
      // could — hang the popup off document.body like the note editor does.
      tooltips({ parent: document.body }),
      knoteAutocomplete,
      // Above the Enter-to-save binding below: when the #tag/@deliverable
      // popup is open, Enter accepts the highlighted option instead of
      // saving. acceptCompletion is a no-op with no popup open, so it falls
      // through to Enter-to-save then (mirrors setupEditor.ts).
      Prec.highest(keymap.of(completionKeymap)),
      Prec.highest(
        keymap.of([
          {
            key: 'Enter',
            run: () => {
              opts.onEnter()
              return true
            }
          },
          {
            key: 'Shift-Enter',
            run: () => {
              opts.onEnter()
              return true
            }
          }
        ])
      ),
      EditorView.domEventHandlers({
        // A task's text is one line on disk — flatten a multi-line paste
        // instead of letting it split the task across lines.
        paste: (event, view) => {
          const text = event.clipboardData?.getData('text/plain')
          if (text === undefined || !/\r?\n/.test(text)) return false
          event.preventDefault()
          view.dispatch(view.state.replaceSelection(text.replace(/\r?\n+/g, ' ')))
          return true
        }
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) opts.onChange(u.state.doc.toString())
      })
    ]
  })
}

/** Replace the whole doc to match an external change (e.g. a toolbar picker), leaving the caret at the end. */
export function syncTaskTitleEditor(view: EditorView, text: string): void {
  if (view.state.doc.toString() === text) return
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: text.length }
  })
}
