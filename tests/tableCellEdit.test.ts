// State-level guards on in-place table cell editing. These build a real
// EditorState carrying the same extensions setupEditor.ts installs (minus the
// view), so they cover the parts that only exist once CodeMirror's state
// machinery is involved: which table renders as a grid vs raw source, whether
// the caret is kept out of a rendered table, and when a live cell session
// survives a document change.
//
// Typing into a cell is DOM behavior and isn't reachable here — see the manual
// checklist in test/integration/tableRender.test.ts.

import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { Autolink, Strikethrough, Table } from '@lezer/markdown'
import { describe, expect, it } from 'vitest'
import {
  activeCellField,
  setActiveCell,
  setTableSource,
  tableCellEdit
} from '@/editor/tableCellEdit'
import { leadingIndentEm, tableRender } from '@/editor/tableRender'

const TABLE = ['| Name | Qty |', '| ---- | --- |', '| Bolt | 12  |', '| Nut  | 3   |'].join('\n')
const LEAD = 'intro\n\n'
const DOC = LEAD + TABLE + '\n\noutro\n'
/** Offset of the table's first line. */
const TABLE_FROM = LEAD.length
const TABLE_TO = LEAD.length + TABLE.length

function mkState(doc = DOC): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ extensions: [Strikethrough, Table, Autolink, { remove: ['IndentedCode'] }] }),
      // Order matters: tableRender's decorations read these fields, and a state
      // field can only read one declared before it.
      tableCellEdit,
      tableRender
    ]
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

function apply(state: EditorState, spec: TransactionSpec): EditorState {
  return state.update(spec).state
}

/** Ranges of `set`, as [from, to] pairs. */
function ranges(state: EditorState, which: 'deco' | 'atoms'): Array<[number, number]> {
  const out: Array<[number, number]> = []
  state.field(tableRender)[which].between(0, state.doc.length, (from, to) => {
    out.push([from, to])
  })
  return out
}

describe('rendered vs source', () => {
  it('renders the table as a single block widget by default', () => {
    const deco = ranges(mkState(), 'deco')
    expect(deco).toEqual([[TABLE_FROM, TABLE_TO]])
  })

  it('keeps rendering it when a bare caret sits on a table line', () => {
    // The whole point of editing cells in place: arriving with the caret must
    // not swap the grid for raw pipes the way every other construct does.
    const state = apply(mkState(), { selection: EditorSelection.cursor(TABLE_FROM + 3) })
    expect(ranges(state, 'deco')).toEqual([[TABLE_FROM, TABLE_TO]])
  })

  it('shows raw source once "Edit table source" targets it', () => {
    const state = apply(mkState(), { effects: setTableSource.of(TABLE_FROM) })
    const deco = ranges(state, 'deco')
    expect(deco.length).toBeGreaterThan(1)
    expect(deco).not.toContainEqual([TABLE_FROM, TABLE_TO])
  })

  it('shows raw source under a non-empty selection, so a search hit is visible', () => {
    const state = apply(mkState(), {
      selection: EditorSelection.range(TABLE_FROM + 2, TABLE_FROM + 6)
    })
    expect(ranges(state, 'deco')).not.toContainEqual([TABLE_FROM, TABLE_TO])
  })

  it('drops back to the grid when the selection leaves the table', () => {
    let state = apply(mkState(), { effects: setTableSource.of(TABLE_FROM) })
    state = apply(state, { selection: EditorSelection.cursor(0) })
    expect(ranges(state, 'deco')).toEqual([[TABLE_FROM, TABLE_TO]])
  })
})

describe('atomic ranges', () => {
  it('covers exactly the rendered table, so the caret cannot land inside it', () => {
    expect(ranges(mkState(), 'atoms')).toEqual([[TABLE_FROM, TABLE_TO]])
  })

  it('is empty in source view, so the raw pipes stay editable', () => {
    const state = apply(mkState(), { effects: setTableSource.of(TABLE_FROM) })
    expect(ranges(state, 'atoms')).toEqual([])
  })
})

describe('activeCellField', () => {
  const activate = (state: EditorState, row = 0, col = 0): EditorState =>
    apply(state, { effects: setActiveCell.of({ tableFrom: TABLE_FROM, row, col, id: 7 }) })

  it('holds the cell the editor was opened on', () => {
    expect(activate(mkState()).field(activeCellField)).toEqual({
      tableFrom: TABLE_FROM,
      row: 0,
      col: 0,
      id: 7
    })
  })

  it('tracks the table when text above it grows', () => {
    const state = apply(activate(mkState()), { changes: { from: 0, insert: 'more\n' } })
    expect(state.field(activeCellField)?.tableFrom).toBe(TABLE_FROM + 5)
  })

  it('ends the session when something else edits the table', () => {
    // Host sync, a VS Code undo echo or a structural menu op all land here.
    // Reconciling them against a live nested document is not attempted.
    const state = apply(activate(mkState()), {
      changes: { from: TABLE_FROM + 2, to: TABLE_FROM + 6, insert: 'Part' }
    })
    expect(state.field(activeCellField)).toBeNull()
  })

  it('survives an edit elsewhere in the note', () => {
    const state = apply(activate(mkState()), { changes: { from: 0, insert: 'x' } })
    expect(state.field(activeCellField)).not.toBeNull()
  })

  it('is cleared by an explicit deactivate', () => {
    const state = apply(activate(mkState()), { effects: setActiveCell.of(null) })
    expect(state.field(activeCellField)).toBeNull()
  })

  // Regression: on a table nested under a task, `findTableAt` couldn't resolve
  // the session's own `tableFrom` (a line start, sitting in the indent rather
  // than inside the `Table` node), so every check below read "the table is
  // gone" and ended the session — which also made Tab/Enter/arrow navigation
  // fall straight out of an indented table (see `move` in tableCellEdit.ts).
  it('survives an unrelated edit when the table is indented under a task', () => {
    const nested = TABLE.split('\n')
      .map((l) => `  ${l}`)
      .join('\n')
    const doc = `- [ ] Restock the bins\n${nested}\n\nouter\n`
    const from = doc.indexOf('  | Name')
    let state = apply(mkState(doc), {
      effects: setActiveCell.of({ tableFrom: from, row: 0, col: 0, id: 7 })
    })
    state = apply(state, { changes: { from: 0, insert: 'x' } })
    expect(state.field(activeCellField)).not.toBeNull()
  })
})

describe("leadingIndentEm (rendering indentTable's leading whitespace)", () => {
  // The em width of one space, restated from hangingIndent.ts so a change
  // there shows up here as a deliberate edit rather than a silent drift.
  const SPACE = 0.274

  it('is zero for a flush-left table, so no padding is added', () => {
    expect(leadingIndentEm(TABLE)).toBe(0)
  })

  it("measures the raw block's own leading whitespace, matching indentTable's 2-space unit", () => {
    const indented = TABLE.split('\n')
      .map((l) => `  ${l}`)
      .join('\n')
    expect(leadingIndentEm(indented)).toBeCloseTo(2 * SPACE, 3)
  })

  it('expands a leading tab to the next multiple of 4, matching CSS tab-size', () => {
    expect(leadingIndentEm(`\t${TABLE}`)).toBeCloseTo(4 * SPACE, 3)
  })
})
