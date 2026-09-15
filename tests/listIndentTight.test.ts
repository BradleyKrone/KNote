// Reproduces the reported bug: with VaultConfig.tabSize set to 6+, Tab on a
// bullet/task line indented the full tab size, which @lezer/markdown no
// longer recognizes as a nested list item — see listIndentTight.ts for the
// mechanism. These tests cover the capped Tab/Shift-Tab behavior directly,
// then prove the cap actually keeps @lezer/markdown's parser producing real
// nested ListItem nodes rather than one flattened paragraph.

import { describe, expect, it } from 'vitest'
import type { EditorState } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { createEditorState } from '@/editor/setupEditor'
import { LIST_INDENT_SAFE_MAX, listIndentLess, listIndentMore } from '@/editor/listIndentTight'

/** Run a CodeMirror command against a state alone (no view/DOM needed). */
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

function listItemCount(state: EditorState, doc: string): number {
  ensureSyntaxTree(state, doc.length, 5000)
  let count = 0
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'ListItem') count++
    }
  })
  return count
}

describe('listIndentMore / listIndentLess', () => {
  it('caps the indent step at LIST_INDENT_SAFE_MAX when tabSize is larger', () => {
    const state = createEditorState({ doc: '- item', tabSize: 6 })
    const { handled, doc } = runCommand(listIndentMore, state)
    expect(handled).toBe(true)
    expect(doc).toBe(`${' '.repeat(LIST_INDENT_SAFE_MAX)}- item`)
  })

  it('removes exactly the capped step on Shift-Tab, not the raw tabSize', () => {
    const state = createEditorState({
      doc: `${' '.repeat(LIST_INDENT_SAFE_MAX)}- item`,
      tabSize: 6
    })
    const { handled, doc } = runCommand(listIndentLess, state)
    expect(handled).toBe(true)
    expect(doc).toBe('- item')
  })

  it('behaves identically to the default indentUnit width when tabSize is already safe (4)', () => {
    const state = createEditorState({ doc: '- item', tabSize: 4 })
    const { doc } = runCommand(listIndentMore, state)
    expect(doc).toBe(`${' '.repeat(4)}- item`)
  })

  it('behaves identically at the boundary, tabSize 5', () => {
    const state = createEditorState({ doc: '- item', tabSize: 5 })
    const { doc } = runCommand(listIndentMore, state)
    expect(doc).toBe(`${' '.repeat(5)}- item`)
  })

  it('treats a task/checkbox line as a list line too', () => {
    const state = createEditorState({ doc: '- [ ] @task foo', tabSize: 16 })
    const { handled, doc } = runCommand(listIndentMore, state)
    expect(handled).toBe(true)
    expect(doc).toBe(`${' '.repeat(LIST_INDENT_SAFE_MAX)}- [ ] @task foo`)
  })

  it('declines a non-list line regardless of tabSize, leaving it for the default indentMore/indentLess', () => {
    const state = createEditorState({ doc: 'plain paragraph text', tabSize: 16 })
    const { handled, doc } = runCommand(listIndentMore, state)
    expect(handled).toBe(false)
    expect(doc).toBe('plain paragraph text')
  })

  it('does not remove past column 0', () => {
    const state = createEditorState({ doc: '- item', tabSize: 6 })
    const { doc } = runCommand(listIndentLess, state)
    expect(doc).toBe('- item')
  })
})

describe('LIST_INDENT_SAFE_MAX vs. @lezer/markdown nesting', () => {
  it('nests correctly at the capped step, three levels deep, however high tabSize is', () => {
    const step = ' '.repeat(LIST_INDENT_SAFE_MAX)
    const doc = ['- level 1', `${step}- level 2`, `${step}${step}- level 3`].join('\n')
    const state = createEditorState({ doc, tabSize: 16 })
    expect(listItemCount(state, doc)).toBe(3)
  })

  it('one space per level past the cap collapses nesting into a single item (the reported bug)', () => {
    const step = ' '.repeat(LIST_INDENT_SAFE_MAX + 1)
    const doc = ['- level 1', `${step}- level 2`].join('\n')
    const state = createEditorState({ doc, tabSize: 16 })
    expect(listItemCount(state, doc)).toBe(1)
  })
})
