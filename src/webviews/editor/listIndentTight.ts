// Keeps Tab/Shift-Tab from producing markdown @lezer/markdown can't parse
// back as a nested list, the same way listContinueTight.ts keeps Enter from
// producing markdown-list side effects the user didn't ask for.
//
// `indentUnit` (setupEditor.ts's tabSizeExtensions) makes Tab/Shift-Tab
// insert or remove exactly `VaultConfig.tabSize` spaces — that's correct and
// tested (editorTabSize.test.ts) for ordinary text. But `@lezer/markdown`'s
// block parser decides list nesting with its own hardcoded, non-configurable
// column arithmetic: a plain `-`/`*`/`+` bullet's content starts at column 2,
// and a line indented 4 or more columns past its parent item's content
// column stops being recognized as that item's continuation/child — it just
// merges into the surrounding paragraph as plain text
// (`skipForList`/`getListIndent` in @lezer/markdown). Since KNote indents
// with spaces via Tab, each level's "extra" indent beyond its parent is
// `tabSize - 2`, constant at every depth — so nesting silently collapses the
// moment `tabSize >= 6`, however high the user is allowed to set it.
// `@lezer/markdown` exposes no facet to teach it a different tab size, so the
// fix is scoped to indenting list lines specifically, capping the step they
// move by instead of shrinking `indentUnit`/`tabSize` for everything else.

import {
  EditorSelection,
  countColumn,
  type ChangeSpec,
  type EditorState,
  type Line,
  type Transaction
} from '@codemirror/state'
import { getIndentUnit, indentString } from '@codemirror/language'
import type { EditorView, KeyBinding } from '@codemirror/view'
import { LIST_ITEM_RE } from '@shared/parser/patterns'

/** The minimal shape a CodeMirror command needs — matches EditorView structurally. */
interface CommandTarget {
  state: EditorState
  dispatch: (tr: Transaction) => void
}

/**
 * Largest per-level indent step that stays inside @lezer/markdown's nesting
 * threshold for a plain bullet: content column 2, plus a strictly-less-than-4
 * safety margin, so `2 + 4 - 1 = 5`. Ordered markers (`1.`, content column 3+)
 * have a wider margin, so this one constant is safe for both.
 */
export const LIST_INDENT_SAFE_MAX = 5

/** Mirrors @codemirror/commands' internal changeBySelectedLine (not exported). */
function changeBySelectedLine(state: EditorState, f: (line: Line, changes: ChangeSpec[]) => void) {
  let atLine = -1
  return state.changeByRange((range) => {
    const changes: ChangeSpec[] = []
    for (let pos = range.from; pos <= range.to;) {
      const line = state.doc.lineAt(pos)
      if (line.number > atLine && (range.empty || range.to > line.from)) {
        f(line, changes)
        atLine = line.number
      }
      pos = line.to + 1
    }
    const changeSet = state.changes(changes)
    return {
      changes,
      range: EditorSelection.range(
        changeSet.mapPos(range.anchor, 1),
        changeSet.mapPos(range.head, 1)
      )
    }
  })
}

/**
 * True only when every line the selection touches is a list/task item
 * (`LIST_ITEM_RE` — bullets, ordered markers, and checkbox lines all match,
 * since the marker+space precedes the `[ ]`). A false here means "not this
 * keypress's concern" — the caller falls through to the default
 * indentMore/indentLess, unchanged, for ordinary text.
 */
function allTouchedLinesAreListItems(state: EditorState): boolean {
  let atLine = -1
  let sawLine = false
  for (const range of state.selection.ranges) {
    for (let pos = range.from; pos <= range.to;) {
      const line = state.doc.lineAt(pos)
      if (line.number > atLine && (range.empty || range.to > line.from)) {
        if (!LIST_ITEM_RE.test(line.text)) return false
        sawLine = true
        atLine = line.number
      }
      pos = line.to + 1
    }
  }
  return sawLine
}

/** Tab on a list/task line: indent by `min(tabSize, LIST_INDENT_SAFE_MAX)`, not the raw tab size. */
export function listIndentMore(target: CommandTarget): boolean {
  const { state } = target
  if (!allTouchedLinesAreListItems(state)) return false
  const step = ' '.repeat(Math.min(getIndentUnit(state), LIST_INDENT_SAFE_MAX))
  target.dispatch(
    state.update(
      changeBySelectedLine(state, (line, changes) => {
        changes.push({ from: line.from, insert: step })
      }),
      { userEvent: 'input.indent' }
    )
  )
  return true
}

/** Shift-Tab on a list/task line: remove one capped step, never past column 0. */
export function listIndentLess(target: CommandTarget): boolean {
  const { state } = target
  if (!allTouchedLinesAreListItems(state)) return false
  const unit = Math.min(getIndentUnit(state), LIST_INDENT_SAFE_MAX)
  target.dispatch(
    state.update(
      changeBySelectedLine(state, (line, changes) => {
        const space = /^\s*/.exec(line.text)?.[0] ?? ''
        if (!space) return
        const col = countColumn(space, state.tabSize)
        const insert = indentString(state, Math.max(0, col - unit))
        let keep = 0
        while (
          keep < space.length &&
          keep < insert.length &&
          space.charCodeAt(keep) === insert.charCodeAt(keep)
        )
          keep++
        changes.push({
          from: line.from + keep,
          to: line.from + space.length,
          insert: insert.slice(keep)
        })
      }),
      { userEvent: 'delete.dedent' }
    )
  )
  return true
}

/** Tab/Shift-Tab keymap; must run ahead of the default indentWithTab. */
export const listIndentTightKeymap: KeyBinding[] = [
  {
    key: 'Tab',
    run: (view: EditorView) => listIndentMore(view),
    shift: (view: EditorView) => listIndentLess(view)
  }
]
