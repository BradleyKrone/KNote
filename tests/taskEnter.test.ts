import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import { planTaskNoteSeed } from '@/editor/taskNoteSeed'

const TODAY = '7/16/2026'

/** Build a state with the caret at `caret` (defaults to end of doc). */
function stateAt(doc: string, caret = doc.length, extensions: Extension[] = []): EditorState {
  return EditorState.create({ doc, selection: EditorSelection.cursor(caret), extensions })
}

/** Apply a seed plan to a doc string, returning the resulting text. */
function apply(doc: string, plan: { at: number; insert: string }): string {
  return doc.slice(0, plan.at) + plan.insert + doc.slice(plan.at)
}

describe('planTaskNoteSeed', () => {
  it('seeds the template when Enter is pressed at the end of a top-level task', () => {
    const doc = '- [ ] @task test'
    const plan = planTaskNoteSeed(stateAt(doc), TODAY)
    expect(plan).not.toBeNull()
    expect(apply(doc, plan!)).toBe(
      '- [ ] @task test\n  - Status Changed: n/a\n  - Date Entered: 7/16/2026\n  - Notes: '
    )
  })

  it('works when the task is not the last line in the document', () => {
    const doc = '- [ ] @task test\n## Notes'
    const caret = '- [ ] @task test'.length
    const plan = planTaskNoteSeed(stateAt(doc, caret), TODAY)
    expect(plan).not.toBeNull()
    expect(apply(doc, plan!)).toBe(
      '- [ ] @task test\n  - Status Changed: n/a\n  - Date Entered: 7/16/2026\n  - Notes: \n## Notes'
    )
  })

  it('ignores a plain bullet with no checkbox', () => {
    expect(planTaskNoteSeed(stateAt('- test'), TODAY)).toBeNull()
  })

  it('ignores an empty checkbox', () => {
    expect(planTaskNoteSeed(stateAt('- [ ] @task '), TODAY)).toBeNull()
  })

  it('ignores a nested (indented) task', () => {
    expect(planTaskNoteSeed(stateAt('  - [ ] sub'), TODAY)).toBeNull()
  })

  it('does not re-seed a task that already has a Date Entered line', () => {
    const doc =
      '- [ ] @task test\n  - Status Changed: n/a\n  - Date Entered: 7/13/2026\n  - Notes: '
    const caret = '- [ ] @task test'.length
    expect(planTaskNoteSeed(stateAt(doc, caret), TODAY)).toBeNull()
  })

  it('anchors below an existing Status Changed line, without a second one', () => {
    const doc = '- [ ] @task test\n  - Status Changed: 7/13/2026'
    const caret = '- [ ] @task test'.length
    const plan = planTaskNoteSeed(stateAt(doc, caret), TODAY)
    expect(plan).not.toBeNull()
    expect(apply(doc, plan!)).toBe(
      '- [ ] @task test\n  - Status Changed: 7/13/2026\n  - Date Entered: 7/16/2026\n  - Notes: '
    )
  })

  it('does not fire when the caret is mid-line', () => {
    expect(planTaskNoteSeed(stateAt('- [ ] @task test', 3), TODAY)).toBeNull()
  })

  it('still seeds when only whitespace follows the caret', () => {
    const doc = '- [ ] @task test  '
    const caret = '- [ ] @task test'.length // caret before the two trailing spaces
    expect(planTaskNoteSeed(stateAt(doc, caret), TODAY)).not.toBeNull()
  })

  it('marks the task line end for a ^block-id anchor on a fresh task', () => {
    const doc = '- [ ] @task test'
    const plan = planTaskNoteSeed(stateAt(doc), TODAY)
    expect(plan!.anchorAt).toBe(doc.length) // end of the task line
  })

  it('does not re-anchor a task that already has a ^block-id', () => {
    const doc = '- [ ] @task test ^abc123'
    const plan = planTaskNoteSeed(stateAt(doc), TODAY)
    expect(plan).not.toBeNull() // still seeds the note block
    expect(plan!.anchorAt).toBeNull()
  })

  it('builds the template with the given line break (CRLF)', () => {
    const doc = '- [ ] @task test'
    const plan = planTaskNoteSeed(stateAt(doc), TODAY, '\r\n')
    expect(plan!.insert).toBe(
      '\r\n  - Status Changed: n/a\r\n  - Date Entered: 7/16/2026\r\n  - Notes: '
    )
  })

  it("indents the seeded block by the editor's configured indentUnit, not a hardcoded 2 spaces", () => {
    const doc = '- [ ] @task test'
    const plan = planTaskNoteSeed(
      stateAt(doc, doc.length, [indentUnit.of('        ')]), // VaultConfig.tabSize: 8
      TODAY
    )
    expect(plan).not.toBeNull()
    expect(apply(doc, plan!)).toBe(
      '- [ ] @task test\n        - Status Changed: n/a\n        - Date Entered: 7/16/2026\n        - Notes: '
    )
  })
})
