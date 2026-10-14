// Keeps @codemirror/lang-markdown's Enter-continues-a-list behavior tight,
// the way Obsidian's editor (and KNote's existing tests) expect it: one Enter
// press, one line break — never a blank line as well.
//
// `markdown()` binds Enter to `insertNewlineContinueMarkup` (markdownKeymap,
// Prec.high — see editorMarkdownDefaults.test.ts). That command has two rough
// edges, both of which read as "Enter fired twice":
//
//  - Once a list is "loose" (a blank line separates its first two items), the
//    command preserves that by inserting a blank line before every later
//    sibling item. In a nested list that blank
//    line is padded to the outer list's indent (`"\n    \n    - "`), and in an
//    ordered list it rides alongside the renumbering changes — so this matches
//    the shape (line break, only whitespace/`>`, line break) on any change,
//    not just a bare `"\n\n"` on a lone one.
//  - Enter on an empty last item would make a tight list loose by inserting a
//    blank line above it. `nonTightLists: false` turns that into removing the
//    marker (exiting the list, or stepping out a level), as Obsidian does.

import { insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import { EditorSelection, type EditorState, type Transaction } from '@codemirror/state'
import type { EditorView, KeyBinding } from '@codemirror/view'

/** The minimal shape a CodeMirror command needs — matches EditorView structurally. */
interface CommandTarget {
  state: EditorState
  dispatch: (tr: Transaction) => void
}

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false })

/** The leading `<break><blank-line padding><break>` only the loose-list branch inserts. */
function loosePrefix(lineBreak: string): RegExp {
  const lb = lineBreak.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
  return new RegExp(`^${lb}[ \\t>]*${lb}`)
}

/** Pure(-ish) core: takes a state/dispatch pair so it's testable without a real EditorView/DOM. */
export function continueListTight(target: CommandTarget): boolean {
  const { state } = target
  const prefix = loosePrefix(state.lineBreak)
  return continueMarkup({
    state,
    dispatch: (tr) => {
      if (state.selection.ranges.length !== 1) return target.dispatch(tr)
      const changes: Array<{ from: number; to: number; insert: string }> = []
      // Mutated inside the iterChanges callback — an object, so TS doesn't narrow it to null.
      const collapsed = { at: -1 }
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        let insert = inserted.toString()
        const m = prefix.exec(insert)
        if (m) {
          insert = state.lineBreak + insert.slice(m[0].length)
          collapsed.at = toA
        }
        changes.push({ from: fromA, to: toA, insert })
      })
      if (collapsed.at < 0) return target.dispatch(tr)
      const cs = state.changes(changes)
      target.dispatch(
        state.update({
          changes: cs,
          selection: EditorSelection.cursor(cs.mapPos(collapsed.at, 1)),
          scrollIntoView: true,
          userEvent: 'input'
        })
      )
    }
  })
}

/** Enter keymap; must run ahead of markdown()'s own (Prec.high) binding. */
export const listContinueTightKeymap: KeyBinding[] = [
  { key: 'Enter', run: (view: EditorView) => continueListTight(view) }
]
