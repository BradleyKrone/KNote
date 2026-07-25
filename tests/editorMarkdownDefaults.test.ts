// Guards two Obsidian behaviors the live-preview editor gets from
// @codemirror/lang-markdown rather than from KNote code: Enter continuing a
// list, and folding a heading's whole section.
//
// Both are easy to break by accident, because KNote layers its own Enter
// binding (taskEnter, at Prec.highest) and its own indentation foldService
// (taskFold) over them — either could shadow the built-in and nothing else
// would notice. markdown() supplies them via markdownKeymap (Enter →
// insertNewlineContinueMarkup, at Prec.high) and the headerIndent foldService.

import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { insertNewlineContinueMarkup, markdown } from '@codemirror/lang-markdown'
import { Autolink, Strikethrough, Table } from '@lezer/markdown'
import { ensureSyntaxTree, foldable } from '@codemirror/language'
import { taskFold } from '../src/webviews/editor/taskFold'
import { taskEnterKeymap } from '../src/webviews/editor/taskEnter'

/** A state carrying the same markdown + fold extensions setupEditor.ts installs. */
function mkState(doc: string, cursor = 0): EditorState {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ extensions: [Strikethrough, Table, Autolink] }), taskFold]
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

/** Run a CodeMirror command against a state alone, returning the resulting doc. */
function runCommand(
  command: (target: {
    state: EditorState
    dispatch: (tr: { state: EditorState }) => void
  }) => boolean,
  state: EditorState
): { handled: boolean; doc: string } {
  let doc = state.doc.toString()
  const handled = command({
    state,
    dispatch: (tr) => {
      doc = tr.state.doc.toString()
    }
  })
  return { handled, doc }
}

describe('markdown editor defaults', () => {
  it('folds a heading section down to the next same-or-higher heading', () => {
    const doc = '# Top\n\n## A\n\nbody of A\nmore A\n\n## B\n\nbody of B\n'
    const state = mkState(doc)

    // "## A" folds its own body but stops at the sibling "## B".
    const a = state.doc.line(3)
    const aRange = foldable(state, a.from, a.to)
    expect(aRange?.from).toBe(a.to)
    const aFolded = state.doc.sliceString(aRange!.from, aRange!.to)
    expect(aFolded).toContain('more A')
    expect(aFolded).not.toContain('## B')

    // "# Top" outranks both, so folding it swallows the whole document.
    const top = state.doc.line(1)
    const topRange = foldable(state, top.from, top.to)
    expect(state.doc.sliceString(topRange!.from, topRange!.to)).toContain('body of B')
  })

  it('still folds an indented block under a task (KNote taskFold)', () => {
    const doc = '- [ ] task\n  - Notes: detail\n- [ ] other\n'
    const state = mkState(doc)
    const line = state.doc.line(1)
    const range = foldable(state, line.from, line.to)
    expect(range).toBeTruthy()
    expect(state.doc.sliceString(range!.from, range!.to)).toContain('Notes: detail')
    expect(state.doc.sliceString(range!.from, range!.to)).not.toContain('other')
  })

  it('continues a bullet list on Enter', () => {
    const doc = '- first item'
    const { handled, doc: after } = runCommand(
      insertNewlineContinueMarkup,
      mkState(doc, doc.length)
    )
    expect(handled).toBe(true)
    expect(after).toBe('- first item\n- ')
  })

  it('continues a numbered list on Enter', () => {
    const doc = '1. first'
    const { handled, doc: after } = runCommand(
      insertNewlineContinueMarkup,
      mkState(doc, doc.length)
    )
    expect(handled).toBe(true)
    expect(after).toBe('1. first\n2. ')
  })

  it("KNote's Enter-to-seed binding falls through on a non-task line", () => {
    // taskEnter sits at Prec.highest, so it must decline anything that isn't a
    // fresh top-level task or list continuation would never be reached.
    const doc = '- plain bullet'
    const { handled } = runCommand(
      (target) => taskEnterKeymap[0].run?.(target as never) ?? false,
      mkState(doc, doc.length)
    )
    expect(handled).toBe(false)
  })
})
