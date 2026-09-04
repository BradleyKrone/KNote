// Reproduces the reported bug: pressing Enter on a plain bullet gets an
// unwanted blank line above the next item whenever an earlier list item (a
// seeded checkbox task's indented Status Changed/Date Entered/Notes block)
// makes @codemirror/lang-markdown consider the whole list "loose" per
// CommonMark. See listContinueTight.ts for the mechanism.

import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { Autolink, Strikethrough, Table } from '@lezer/markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { continueListTight } from '@/editor/listContinueTight'

/** A state carrying the same markdown extensions setupEditor.ts installs. */
function mkState(doc: string, cursor: number): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ extensions: [Strikethrough, Table, Autolink, { remove: ['IndentedCode'] }] })]
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

/** Run continueListTight against a state alone, returning the resulting doc + cursor. */
function run(state: EditorState): { handled: boolean; doc: string; cursor: number } {
  let doc = state.doc.toString()
  let cursor = state.selection.main.head
  const handled = continueListTight({
    state,
    dispatch: (tr) => {
      doc = tr.state.doc.toString()
      cursor = tr.state.selection.main.head
    }
  })
  return { handled, doc, cursor }
}

describe('continueListTight', () => {
  it('collapses the blank-line-before-next-item behavior under a seeded task', () => {
    const doc =
      '- [ ] where is this\n  - Status Changed: n/a\n  - Date Entered: 9/3/2026\n  - Notes: \n- test'
    const cursor = doc.length // end of "- test"
    const { handled, doc: after } = run(mkState(doc, cursor))
    expect(handled).toBe(true)
    expect(after).toBe(doc + '\n- ')
  })

  it('still continues a plain tight list with a single newline (no task involved)', () => {
    const doc = '- first item'
    const { handled, doc: after } = run(mkState(doc, doc.length))
    expect(handled).toBe(true)
    expect(after).toBe('- first item\n- ')
  })

  it('still continues a numbered list on Enter', () => {
    const doc = '1. first'
    const { handled, doc: after } = run(mkState(doc, doc.length))
    expect(handled).toBe(true)
    expect(after).toBe('1. first\n2. ')
  })

  it('leaves the tight-to-loose-on-empty-item convention alone', () => {
    // Pressing Enter on an empty second (and last) bullet is
    // insertNewlineContinueMarkup's own "make this list non-tight" behavior
    // (a single blank line inserted before that item, not a double newline
    // at the cursor) — a different code path from the bug this file fixes,
    // and this must still run exactly as the library defines it.
    const doc = '- one\n- '
    const { handled, doc: after } = run(mkState(doc, doc.length))
    expect(handled).toBe(true)
    expect(after).toBe('- one\n\n- ')
  })
})
