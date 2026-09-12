// End-to-end check that `VaultConfig.tabSize` actually reaches Tab-key
// behavior in the real editor — not just the indentUnit facet in isolation
// (see editorMarkdownDefaults.test.ts), but createEditor's *whole* extension
// stack, in case some other extension in that list silently outranked our
// indentUnit/tabSize facet values once everything is combined.
import { describe, expect, it } from 'vitest'
import type { EditorState } from '@codemirror/state'
import { indentLess, indentMore } from '@codemirror/commands'
import { createEditorState, withTabSize } from '@/editor/setupEditor'

/** Run a CodeMirror command against a state alone (no view/DOM needed). */
function runCommand(
  command: (target: {
    state: EditorState
    dispatch: (tr: { state: EditorState }) => void
  }) => boolean,
  state: EditorState
): string {
  let doc = state.doc.toString()
  command({
    state,
    dispatch: (tr) => {
      doc = tr.state.doc.toString()
    }
  })
  return doc
}

describe("createEditor's real extension stack honors VaultConfig.tabSize", () => {
  it('Tab (indentMore) inserts exactly `tabSize` spaces at the default of 4', () => {
    const state = createEditorState({ doc: 'line one' })
    expect(runCommand(indentMore, state)).toBe('    line one')
  })

  it('Tab inserts `tabSize` spaces when tabSize is 16, not the CodeMirror default of 2', () => {
    const state = createEditorState({ doc: 'line one', tabSize: 16 })
    expect(runCommand(indentMore, state)).toBe(`${' '.repeat(16)}line one`)
  })

  it('Shift-Tab (indentLess) removes one `tabSize`-wide step', () => {
    const state = createEditorState({ doc: `${' '.repeat(8)}line one`, tabSize: 8 })
    expect(runCommand(indentLess, state)).toBe('line one')
  })

  it('the Vault Settings live-update path (withTabSize, what setTabSize dispatches into an open view) actually changes what Tab inserts', () => {
    let state = createEditorState({ doc: 'line one', tabSize: 4 })
    expect(runCommand(indentMore, state)).toBe('    line one') // still 4 before reconfigure

    state = withTabSize(createEditorState({ doc: 'line one', tabSize: 4 }), 16)
    expect(runCommand(indentMore, state)).toBe(`${' '.repeat(16)}line one`)
  })
})
