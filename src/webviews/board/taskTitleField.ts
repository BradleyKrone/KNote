// A single-line CodeMirror view for the task dialog's title field. Deliberately
// not the full note editor (`editor/setupEditor.ts`) — no markdown grammar,
// tables or embeds — just the same #tag/priority styling `knoteConstructs.ts`
// gives a task line in the real editor, so the title here reads the same way
// it does on the card and in a note instead of showing raw `#tag`/`!!` markup
// as plain text. It is spell checked like a note, with its own right-click
// spell menu (the note editor's full menu isn't mounted on it).

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
import { DELIVERABLE_REF_RE, PRIORITY_RE, TAG_RE } from '@shared/parser/patterns'
import { knoteAutocomplete } from '../editor/completions'
import { DeliverableRefWidget } from '../editor/knoteConstructs'
import { knoteTooltipTheme } from '../editor/theme'
import { replaceWord } from '../shared/spellcheck/spellActions'
import { misspelledRangeAt, spellCheck } from '../shared/spellcheck/spellCheck'
import { openSpellMenu } from '../shared/spellcheck/SpellMenu'

function buildDecorations(text: string, definesDeliverable: string | null): DecorationSet {
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

  // @deliverable(project/name) — same collapsed pill the note editor gives it
  // (DeliverableRefWidget), rather than showing the raw markup here.
  DELIVERABLE_REF_RE.lastIndex = 0
  for (let m = DELIVERABLE_REF_RE.exec(text); m; m = DELIVERABLE_REF_RE.exec(text)) {
    const from = m.index
    const to = from + m[0].length
    const isDefining = definesDeliverable === `deliverable/${m[1]}/${m[2]}`
    decorations.push(
      Decoration.replace({ widget: new DeliverableRefWidget(m[1], m[2], isDefining) }).range(
        from,
        to
      )
    )
  }

  return Decoration.set(decorations, true)
}

const decorateTitle = (definesDeliverable: string | null) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view.state.doc.toString(), definesDeliverable)
      }
      update(update: ViewUpdate): void {
        if (update.docChanged) {
          this.decorations = buildDecorations(update.state.doc.toString(), definesDeliverable)
        }
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
  /**
   * The bare `deliverable/<project>/<name>` tag this task's line defines, if
   * any — same value as `BoardCard.definesDeliverable` — so its
   * `@deliverable(...)` pill renders filled rather than outlined, matching
   * the note editor. `null` for a brand-new card, which can't define one yet.
   */
  definesDeliverable?: string | null
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
      decorateTitle(opts.definesDeliverable ?? null),
      spellCheck,
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
        // Right-click on a misspelled word: suggestions / add / ignore.
        // Anywhere else keeps the native menu.
        contextmenu: (event, view) => {
          const point = { x: event.clientX, y: event.clientY }
          const pos = view.posAtCoords(point)
          const span = pos == null ? null : misspelledRangeAt(view, pos)
          if (!span) return false
          event.preventDefault()
          openSpellMenu({ ...point, word: span.word, replace: (s) => replaceWord(view, span, s) })
          return true
        },
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
