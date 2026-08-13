// Which row and column the right-click menu operates on (tableEdit.ts).
//
// The regression these cover: every structural op — insert row above/below,
// delete row, insert column left/right, delete column — landed on the header
// row and the first column instead of the cell under the mouse, because the
// context was resolved after the handler had already invalidated the DOM it
// was reading. The hit-test itself is split into two pure-ish halves so both
// are reachable from here; only the `posAtDOM`/`EditorView` plumbing that
// picks between them needs the F5 dev host.

import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { Autolink, Strikethrough, Table } from '@lezer/markdown'
import { describe, expect, it } from 'vitest'
import {
  deleteColumn,
  indentTable,
  insertRow,
  readTableCtx,
  tableCtxFromCell,
  tableCtxFromSource
} from '@/editor/tableEdit'

const TABLE = [
  '| Name | Qty | Bin |',
  '| ---- | --- | --- |',
  '| Bolt | 12  | A1  |',
  '| Nut  | 3   | B2  |',
  '| Cam  | 7   | C3  |'
].join('\n')
const SECOND = ['| Tool | Owner |', '| ---- | ----- |', '| Saw  | Bea   |'].join('\n')
const LEAD = 'intro\n\n'
const DOC = `${LEAD}${TABLE}\n\nmiddle\n\n${SECOND}\n\noutro\n`
const TABLE_FROM = LEAD.length
const SECOND_FROM = DOC.indexOf(SECOND)

function mkState(doc = DOC): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ extensions: [Strikethrough, Table, Autolink, { remove: ['IndentedCode'] }] })
    ]
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

/**
 * A DOM-free stand-in for EditorView, faithful enough to drive `indentTable`
 * end to end: real `dispatch` semantics (accepts a spec or an
 * already-built Transaction, same as the genuine view), backed by a real
 * EditorState so `indentMore`/`indentLess` run unmodified. `focus` is a no-op
 * since there's no DOM here to focus.
 */
function fakeView(state: EditorState): EditorView {
  const view = {
    get state(): EditorState {
      return view._state
    },
    _state: state,
    dispatch(trOrSpec: Transaction | TransactionSpec): void {
      const tr = trOrSpec instanceof Transaction ? trOrSpec : view._state.update(trOrSpec)
      view._state = tr.state
    },
    focus(): void {}
  }
  return view as unknown as EditorView
}

/** Offset of `text` on the table line `line` (0 = header, 2 = first data row). */
function posOf(line: number, text: string): number {
  const lines = TABLE.split('\n')
  const lineFrom = TABLE_FROM + lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0)
  return lineFrom + lines[line].indexOf(text)
}

/**
 * The parts of a rendered grid's `<td>`/`<th>` the hit-test reads. A stub, not
 * a DOM: vitest runs under Node here (see tests/setup.ts), and the real cells
 * are built by tableRender.buildTable, which the integration checklist covers.
 */
function fakeCell(opts: {
  row?: number
  col: number
  header?: boolean
  orphan?: boolean
}): HTMLTableCellElement {
  const tr = opts.orphan ? null : { sectionRowIndex: opts.row ?? 0 }
  return {
    cellIndex: opts.col,
    closest: (sel: string) => {
      if (sel === 'thead') return opts.header ? {} : null
      if (sel === 'tr') return opts.header ? {} : tr
      return null
    }
  } as unknown as HTMLTableCellElement
}

describe('tableCtxFromCell (rendered grid)', () => {
  it('targets the clicked cell, not the first row/column', () => {
    const ctx = tableCtxFromCell(mkState(), TABLE_FROM, fakeCell({ row: 2, col: 2 }))
    expect(ctx).toMatchObject({ rowIndex: 2, colIndex: 2, tableFrom: TABLE_FROM })
    expect(ctx?.table.rows[ctx.rowIndex][ctx.colIndex]).toBe('C3')
  })

  it('reads a header cell as the header row', () => {
    const ctx = tableCtxFromCell(mkState(), TABLE_FROM, fakeCell({ col: 1, header: true }))
    expect(ctx).toMatchObject({ rowIndex: -1, colIndex: 1 })
  })

  it('resolves the table at the offset it was given, not the first in the note', () => {
    const ctx = tableCtxFromCell(mkState(), SECOND_FROM, fakeCell({ row: 0, col: 1 }))
    expect(ctx?.tableFrom).toBe(SECOND_FROM)
    expect(ctx?.table.header).toEqual(['Tool', 'Owner'])
    expect(ctx?.table.rows[0][1]).toBe('Bea')
  })

  it('clamps a row or column the document no longer has', () => {
    const state = mkState()
    expect(tableCtxFromCell(state, TABLE_FROM, fakeCell({ row: 9, col: 9 }))).toMatchObject({
      rowIndex: 2,
      colIndex: 2
    })
  })

  it('returns null rather than row 0 when the cell has no row', () => {
    expect(tableCtxFromCell(mkState(), TABLE_FROM, fakeCell({ col: 0, orphan: true }))).toBeNull()
  })

  it('returns null when no table lives at the offset', () => {
    expect(tableCtxFromCell(mkState(), 0, fakeCell({ row: 0, col: 0 }))).toBeNull()
  })
})

describe('tableCtxFromSource (raw pipe view)', () => {
  it('reads the header and delimiter lines as the header row', () => {
    const state = mkState()
    expect(tableCtxFromSource(state, posOf(0, 'Qty'))).toMatchObject({ rowIndex: -1, colIndex: 1 })
    expect(tableCtxFromSource(state, posOf(1, '---'))).toMatchObject({ rowIndex: -1 })
  })

  it('reads each data line as its own row', () => {
    const state = mkState()
    expect(tableCtxFromSource(state, posOf(2, 'Bolt'))).toMatchObject({ rowIndex: 0, colIndex: 0 })
    expect(tableCtxFromSource(state, posOf(3, 'B2'))).toMatchObject({ rowIndex: 1, colIndex: 2 })
    expect(tableCtxFromSource(state, posOf(4, '7'))).toMatchObject({ rowIndex: 2, colIndex: 1 })
  })

  it('clamps a click past the last column to the last column', () => {
    const past = posOf(2, 'A1  |') + 5 // after the closing pipe
    expect(tableCtxFromSource(mkState(), past)).toMatchObject({ rowIndex: 0, colIndex: 2 })
  })

  it('spans the whole table block', () => {
    const ctx = tableCtxFromSource(mkState(), posOf(2, 'Bolt'))
    expect(ctx?.tableFrom).toBe(TABLE_FROM)
    expect(ctx?.tableTo).toBe(TABLE_FROM + TABLE.length)
  })

  it('returns null outside any table', () => {
    expect(tableCtxFromSource(mkState(), 1)).toBeNull()
  })
})

describe('indentTable (right-click Table ▸ Indent/Outdent — nesting a table under a task)', () => {
  const INDENTED_TABLE = TABLE.split('\n')
    .map((l) => `  ${l}`)
    .join('\n')
  const INDENTED_DOC =
    DOC.slice(0, TABLE_FROM) + INDENTED_TABLE + DOC.slice(TABLE_FROM + TABLE.length)

  it('indents every line of the table by one indent unit, as a single edit', () => {
    const view = fakeView(mkState())
    const ctx = tableCtxFromSource(view.state, posOf(2, 'Bolt'))!
    indentTable(view, ctx, 'more')
    expect(view.state.doc.toString()).toBe(INDENTED_DOC)
  })

  it('leaves everything outside the table untouched', () => {
    const view = fakeView(mkState())
    const ctx = tableCtxFromSource(view.state, posOf(2, 'Bolt'))!
    indentTable(view, ctx, 'more')
    const doc = view.state.doc.toString()
    expect(doc.startsWith(LEAD)).toBe(true)
    expect(doc).toContain(`\n\nmiddle\n\n${SECOND}\n\noutro\n`)
  })

  it('dedents an indented table back to flush-left', () => {
    const view = fakeView(mkState(INDENTED_DOC))
    const ctx = tableCtxFromSource(view.state, INDENTED_DOC.indexOf('Bolt'))!
    indentTable(view, ctx, 'less')
    expect(view.state.doc.toString()).toBe(DOC)
  })

  it('only touches the table under the given ctx, not the second table', () => {
    const view = fakeView(mkState())
    const ctx = tableCtxFromSource(view.state, posOf(2, 'Bolt'))!
    indentTable(view, ctx, 'more')
    expect(view.state.doc.toString()).toContain(SECOND)
  })

  // Regression: an indented table with nothing else around it used to be
  // indistinguishable from a CommonMark indented code block once its raw
  // indent reached 4 spaces (two "Indent table" clicks), so the syntax tree
  // stopped reporting a `Table` node there at all — which is what
  // tableRender.ts and readTableCtx (this file's tableCtxFromSource /
  // tableCtxFromCell) both key off of. That silently dropped the table out of
  // live-preview rendering *and* out of the right-click menu, with no error to
  // say why. mkState's `remove: ['IndentedCode']` (matching setupEditor.ts) is
  // what keeps it a `Table`.
  it('keeps resolving as a table indented past 4 spaces', () => {
    const doubleIndented = TABLE.split('\n')
      .map((l) => `    ${l}`)
      .join('\n')
    const doc = DOC.slice(0, TABLE_FROM) + doubleIndented + DOC.slice(TABLE_FROM + TABLE.length)
    const state = mkState(doc)
    expect(tableCtxFromSource(state, doc.indexOf('Bolt'))).toMatchObject({
      rowIndex: 0,
      colIndex: 0
    })
  })

  it('stays resolvable across two separate Indent table clicks', () => {
    // Each right-click re-resolves `ctx` from wherever the user actually
    // clicked (EditorContextMenu.tsx's onContextMenu), so this mirrors that:
    // indent once, then re-resolve ctx against the now-indented document
    // before indenting again — not reusing the first (now stale) ctx.
    const view = fakeView(mkState())
    const firstCtx = tableCtxFromSource(view.state, posOf(2, 'Bolt'))!
    indentTable(view, firstCtx, 'more')
    const secondCtx = tableCtxFromSource(view.state, view.state.doc.toString().indexOf('Bolt'))!
    indentTable(view, secondCtx, 'more')
    const doc = view.state.doc.toString()
    const dataLine = doc.split('\n').find((l) => l.includes('Bolt'))!
    expect(/^\s*/.exec(dataLine)?.[0]).toBe('    ')
    expect(tableCtxFromSource(view.state, doc.indexOf('Bolt'))).toMatchObject({
      rowIndex: 0,
      colIndex: 0
    })
  })
})

// Regression: right-clicking an *indented* table (one nested under a task by
// Table ▸ Indent table) stopped offering the Table submenu at all. The `Table`
// syntax node begins at the first `|`, past the indent, but every caller's
// `tableFrom` is a line start — that's what tableRender's replace decoration
// spans and what `posAtDOM` on the rendered widget answers. findTableAt used to
// hand back the node's own `from`, so the two disagreed by exactly the indent
// width and the lookup for the clicked cell came up empty.
describe('indented tables (nested under a task)', () => {
  const INDENT = '  '
  const NESTED = TABLE.split('\n')
    .map((l) => `${INDENT}${l}`)
    .join('\n')
  const NESTED_DOC = `- [ ] Restock the bins\n${NESTED}\n\nouter\n`
  /** The table block's first *line* start — before the indent, not after it. */
  const NESTED_FROM = NESTED_DOC.indexOf(`${INDENT}| Name`)

  it('reports the table block from its line start, indent included', () => {
    const ctx = tableCtxFromSource(mkState(NESTED_DOC), NESTED_DOC.indexOf('Bolt'))
    expect(ctx?.tableFrom).toBe(NESTED_FROM)
    expect(ctx?.tableTo).toBe(NESTED_FROM + NESTED.length)
    expect(ctx?.table.indent).toBe(INDENT)
  })

  it('resolves the clicked cell of a rendered indented table', () => {
    // NESTED_FROM is what `posAtDOM` on the rendered widget hands back.
    const ctx = tableCtxFromCell(mkState(NESTED_DOC), NESTED_FROM, fakeCell({ row: 1, col: 2 }))
    expect(ctx).toMatchObject({ rowIndex: 1, colIndex: 2, tableFrom: NESTED_FROM })
    expect(ctx?.table.rows[1][2]).toBe('B2')
  })

  it('resolves a right-click landing in the leading indent itself', () => {
    const state = mkState(NESTED_DOC)
    expect(tableCtxFromSource(state, NESTED_DOC.indexOf(`${INDENT}| Bolt`))).toMatchObject({
      rowIndex: 0,
      colIndex: 0
    })
  })

  it('keeps the table nested when a structural edit rewrites it', () => {
    const view = fakeView(mkState(NESTED_DOC))
    const ctx = tableCtxFromSource(view.state, NESTED_DOC.indexOf('Bolt'))!
    insertRow(view, ctx, 1)
    const lines = view.state.doc
      .toString()
      .split('\n')
      .filter((l) => l.includes('|'))
    expect(lines).toHaveLength(TABLE.split('\n').length + 1)
    for (const line of lines) expect(line.startsWith(INDENT)).toBe(true)
  })

  it('keeps the table nested when a column is deleted', () => {
    const view = fakeView(mkState(NESTED_DOC))
    const ctx = tableCtxFromSource(view.state, NESTED_DOC.indexOf('Qty'))!
    deleteColumn(view, ctx, ctx.colIndex)
    const doc = view.state.doc.toString()
    expect(doc).not.toContain('Qty')
    for (const line of doc.split('\n').filter((l) => l.includes('|'))) {
      expect(line.startsWith(INDENT)).toBe(true)
    }
  })
})

describe('readTableCtx (right-click hit-testing)', () => {
  /** A `.cm-md-table-wrap` element right-clicked in its own padding, not on a cell. */
  function fakeWrapPadding(): HTMLElement {
    return {
      closest: (sel: string) => (sel === '.cm-md-table-wrap' ? {} : null)
    } as unknown as HTMLElement
  }

  // Regression: `indentTable` (nesting a table under a task) grows the
  // rendered widget's own left padding to visually match the raw indent
  // (leadingIndentEm in tableRender.ts) — the more it's indented, the wider
  // that gutter gets. A right-click landing there used to return null
  // outright ("lands in the rendered widget's own padding" was documented as
  // a dead end), so the deeper a table was indented, the easier it was to
  // right-click it and get no Table submenu at all.
  it('falls back to the position-based lookup when the click misses every cell', () => {
    const view = fakeView(mkState())
    const ctx = readTableCtx(view, posOf(2, 'Bolt'), fakeWrapPadding())
    expect(ctx).toMatchObject({ tableFrom: TABLE_FROM, rowIndex: 0, colIndex: 0 })
  })

  it('still returns null when the click is nowhere near a table', () => {
    const view = fakeView(mkState())
    expect(readTableCtx(view, 0, fakeWrapPadding())).toBeNull()
  })
})
