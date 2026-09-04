// Keeps @codemirror/lang-markdown's Enter-continues-a-list behavior tight,
// the way Obsidian's editor (and KNote's existing tests) expect it.
//
// `markdown()` binds Enter to `insertNewlineContinueMarkup` (markdownKeymap,
// Prec.high — see editorMarkdownDefaults.test.ts). That command has one rough
// edge: per CommonMark, a list is "loose" once any one of its items spans more
// than one block — which is exactly what a checkbox task's indented Status
// Changed/Date Entered/Notes block does to the flat bullet list it sits in.
// Once the enclosing list is "loose", the command preserves that by inserting
// a blank line before every later sibling item, even a short one-line bullet
// with no blank line of its own — so typing a plain "- foo" under an
// unrelated seeded task got an unwanted blank line above the next "- bar".
// There's no config flag for this (the library's `nonTightLists` option only
// covers a different branch: dedenting an empty item), so this wraps the
// command and collapses that blank-line prefix back to a single newline,
// identifying it by the one change shape only that branch produces.

import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import { EditorSelection, type EditorState, type Transaction } from '@codemirror/state'
import type { EditorView, KeyBinding } from '@codemirror/view'

/** The minimal shape a CodeMirror command needs — matches EditorView structurally. */
interface CommandTarget {
  state: EditorState
  dispatch: (tr: Transaction) => void
}

/** Pure(-ish) core: takes a state/dispatch pair so it's testable without a real EditorView/DOM. */
export function continueListTight(target: CommandTarget): boolean {
  const { state } = target
  let collapsed: { from: number; to: number; insert: string; cursor: number } | null = null
  const handled = insertNewlineContinueMarkup({
    state,
    dispatch: (tr) => {
      const changes: Array<{ from: number; to: number; insert: string }> = []
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changes.push({ from: fromA, to: toA, insert: inserted.toString() })
      })
      // Only the "continue into a list CommonMark considers loose" branch
      // stacks two line breaks ahead of the marker in one change — the
      // "make a tight list loose" branch (Enter on an empty last item) and
      // the "exit the list" branch each insert at most one, so this shape is
      // unique to the case this file exists to fix.
      const change = changes.length === 1 ? changes[0] : null
      if (change && change.insert.startsWith(`${state.lineBreak}${state.lineBreak}`)) {
        const insert = change.insert.slice(state.lineBreak.length)
        collapsed = { from: change.from, to: change.to, insert, cursor: change.from + insert.length }
      }
      if (!collapsed) target.dispatch(tr)
    }
  })
  if (collapsed) {
    const c: { from: number; to: number; insert: string; cursor: number } = collapsed
    target.dispatch(
      state.update({
        changes: { from: c.from, to: c.to, insert: c.insert },
        selection: EditorSelection.cursor(c.cursor),
        scrollIntoView: true,
        userEvent: 'input'
      })
    )
  }
  return handled
}

/** Enter keymap; must run ahead of markdown()'s own (Prec.high) binding. */
export const listContinueTightKeymap: KeyBinding[] = [
  { key: 'Enter', run: (view: EditorView) => continueListTight(view) }
]
