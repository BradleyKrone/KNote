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
import { EditorState } from '@codemirror/state'
import { Autolink, Strikethrough, Table } from '@lezer/markdown'
import { describe, expect, it } from 'vitest'
import { tableCtxFromCell, tableCtxFromSource } from '@/editor/tableEdit'

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
    extensions: [markdown({ extensions: [Strikethrough, Table, Autolink] })]
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
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
