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
    extensions: [
      markdown({ extensions: [Strikethrough, Table, Autolink, { remove: ['IndentedCode'] }] })
    ]
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
      '- [ ] @task where is this\n  - Status Changed: n/a\n  - Date Entered: 9/3/2026\n  - Notes: \n- test'
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

  it('exits the list on Enter in an empty item instead of adding a blank line', () => {
    // nonTightLists: false — the library's default would make the list loose
    // ('- one\n\n- '), i.e. two line breaks for one press.
    const doc = '- one\n- '
    const { handled, doc: after } = run(mkState(doc, doc.length))
    expect(handled).toBe(true)
    expect(after).toBe('- one\n')
  })

  it('continues a nested item in a loose nested list with a single newline', () => {
    // A blank line between its first two items makes the nested list loose, and
    // the library pads the blank line it adds to the outer indent
    // ('\n \n  - '), which a bare '\n\n' check missed — the reported double Enter.
    const doc = '- [ ] @task t\n  - a\n\n  - b'
    const { handled, doc: after, cursor } = run(mkState(doc, doc.length))
    expect(handled).toBe(true)
    expect(after).toBe(doc + '\n  - ')
    expect(cursor).toBe(after.length)
  })

  it('continues a loose numbered list with a single newline and still renumbers', () => {
    const doc = '1. a\n\n2. b\n3. c'
    const cursor = '1. a\n\n2. b'.length
    const { handled, doc: after, cursor: caret } = run(mkState(doc, cursor))
    expect(handled).toBe(true)
    expect(after).toBe('1. a\n\n2. b\n3. \n4. c')
    expect(caret).toBe('1. a\n\n2. b\n3. '.length)
  })

  it('steps out one level on Enter in an empty nested item', () => {
    const doc = '- a\n  - b\n  - '
    const { handled, doc: after } = run(mkState(doc, doc.length))
    expect(handled).toBe(true)
    expect(after).toBe('- a\n  - b\n- ')
  })
})
