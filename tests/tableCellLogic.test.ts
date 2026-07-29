import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  cellRange,
  cellText,
  commitPlan,
  maskActiveCell,
  nextCell,
  type ActiveCell,
  type TableShape
} from '@/editor/tableCellLogic'

const TABLE = ['| Name | Qty |', '| ---- | --- |', '| Bolt | 12  |', '| Nut  | 3   |'].join('\n')

/** A doc with a paragraph above the table, so tableFrom is never 0. */
function docWithTable(table = TABLE): { state: EditorState; tableFrom: number } {
  const lead = 'intro\n\n'
  return { state: EditorState.create({ doc: lead + table }), tableFrom: lead.length }
}

function active(tableFrom: number, row: number, col: number): ActiveCell {
  return { tableFrom, row, col, id: 1 }
}

describe('cellRange', () => {
  it('spans a header cell including its padding, excluding the pipes', () => {
    const { state, tableFrom } = docWithTable()
    const r = cellRange(state, tableFrom, -1, 0)!
    expect(state.sliceDoc(r.from, r.to)).toBe(' Name ')
  })

  it('spans a body cell on the right row', () => {
    const { state, tableFrom } = docWithTable()
    const r = cellRange(state, tableFrom, 1, 1)!
    expect(state.sliceDoc(r.from, r.to)).toBe(' 3   ')
  })

  it('handles a row with no outer pipes', () => {
    const { state, tableFrom } = docWithTable(['A | B', '--|--', '1 | 2'].join('\n'))
    const first = cellRange(state, tableFrom, 0, 0)!
    const second = cellRange(state, tableFrom, 0, 1)!
    expect(state.sliceDoc(first.from, first.to)).toBe('1 ')
    expect(state.sliceDoc(second.from, second.to)).toBe(' 2')
  })

  it('keeps an escaped pipe inside its cell', () => {
    const { state, tableFrom } = docWithTable(
      ['| A | B |', '|---|---|', '| a \\| b | c |'].join('\n')
    )
    const r = cellRange(state, tableFrom, 0, 0)!
    expect(state.sliceDoc(r.from, r.to)).toBe(' a \\| b ')
  })

  it('returns null for a column a ragged row does not have', () => {
    const { state, tableFrom } = docWithTable(['| A | B |', '|---|---|', '| 1 |'].join('\n'))
    expect(cellRange(state, tableFrom, 0, 1)).toBeNull()
  })

  it('returns null past the end of the table', () => {
    const { state, tableFrom } = docWithTable()
    expect(cellRange(state, tableFrom, 9, 0)).toBeNull()
  })

  it('returns null when tableFrom is not a line start', () => {
    const { state, tableFrom } = docWithTable()
    expect(cellRange(state, tableFrom + 1, -1, 0)).toBeNull()
  })
})

describe('cellText', () => {
  it('is the trimmed, unescaped text the rendered table shows', () => {
    const { state, tableFrom } = docWithTable(
      ['| A | B |', '|---|---|', '| a \\| b | c |'].join('\n')
    )
    expect(cellText(state, tableFrom, 0, 0)).toBe('a | b')
    expect(cellText(state, tableFrom, -1, 1)).toBe('B')
  })

  it('is an empty string for a blank cell', () => {
    const { state, tableFrom } = docWithTable(['| A | B |', '|---|---|', '|   |   |'].join('\n'))
    expect(cellText(state, tableFrom, 0, 0)).toBe('')
  })
})

describe('commitPlan', () => {
  it('replaces exactly one cell and leaves the rest of the document alone', () => {
    const { state, tableFrom } = docWithTable()
    const plan = commitPlan(state, active(tableFrom, 0, 1), '99')!
    const after = state.update({ changes: plan }).state.doc.toString()
    expect(after).toBe(
      ['intro', '', '| Name | Qty |', '| ---- | --- |', '| Bolt | 99 |', '| Nut  | 3   |'].join(
        '\n'
      )
    )
  })

  it('changes exactly one line', () => {
    const { state, tableFrom } = docWithTable()
    const plan = commitPlan(state, active(tableFrom, 1, 0), 'Washer')!
    const before = state.doc.toString().split('\n')
    const after = state.update({ changes: plan }).state.doc.toString().split('\n')
    expect(after.length).toBe(before.length)
    expect(after.filter((l, i) => l !== before[i])).toHaveLength(1)
  })

  it('never inserts a line break, whatever the cell text contains', () => {
    const { state, tableFrom } = docWithTable()
    const plan = commitPlan(state, active(tableFrom, 0, 0), 'one\r\ntwo\nthree')!
    expect(plan.insert).not.toMatch(/[\r\n]/)
    expect(plan.insert).toBe(' one two three ')
  })

  it('escapes a typed pipe so the cell does not split in two', () => {
    const { state, tableFrom } = docWithTable()
    const plan = commitPlan(state, active(tableFrom, 0, 0), 'a | b')!
    expect(plan.insert).toBe(' a \\| b ')
    const after = state.update({ changes: plan }).state
    expect(cellText(after, tableFrom, 0, 0)).toBe('a | b')
  })

  it('is null when the document already says exactly this', () => {
    const { state, tableFrom } = docWithTable(['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n'))
    expect(commitPlan(state, active(tableFrom, 0, 0), '1')).toBeNull()
  })

  it('is null when the cell does not resolve', () => {
    const { state, tableFrom } = docWithTable()
    expect(commitPlan(state, active(tableFrom, 9, 0), 'x')).toBeNull()
  })

  it('round-trips an emptied cell', () => {
    const { state, tableFrom } = docWithTable()
    const plan = commitPlan(state, active(tableFrom, 0, 0), '')!
    const after = state.update({ changes: plan }).state
    expect(cellText(after, tableFrom, 0, 0)).toBe('')
    expect(cellText(after, tableFrom, 0, 1)).toBe('12')
  })
})

// TableWidget.eq() compares masked text. If two versions of a table that differ
// only inside the cell being typed into stop comparing equal, CodeMirror
// rebuilds the table's DOM on every keystroke and the cell loses focus
// mid-word — so these are the guards on in-place editing working at all.
describe('maskActiveCell', () => {
  const typed = (cell: string): string =>
    ['| Name | Qty |', '| ---- | --- |', `|${cell}| 12  |`].join('\n')

  it('hides a difference inside the active cell', () => {
    const a = maskActiveCell(typed(' Bo '), { row: 0, col: 0 })
    const b = maskActiveCell(typed(' Bolt '), { row: 0, col: 0 })
    expect(a).toBe(b)
  })

  it('still shows a difference in a different cell of the same row', () => {
    const a = maskActiveCell(typed(' Bolt '), { row: 0, col: 1 })
    const b = maskActiveCell(typed(' Nut '), { row: 0, col: 1 })
    expect(a).not.toBe(b)
  })

  it('still shows a difference in another row', () => {
    const base = ['| A | B |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |']
    const a = maskActiveCell(base.join('\n'), { row: 0, col: 0 })
    const b = maskActiveCell([...base.slice(0, 3), '| 9 | 4 |'].join('\n'), { row: 0, col: 0 })
    expect(a).not.toBe(b)
  })

  it('masks the header row for row -1', () => {
    const a = maskActiveCell(['| A | B |', '|---|---|'].join('\n'), { row: -1, col: 0 })
    const b = maskActiveCell(['| Alpha | B |', '|---|---|'].join('\n'), { row: -1, col: 0 })
    expect(a).toBe(b)
  })

  it('is the identity with no active cell, or for coordinates off the table', () => {
    const raw = ['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n')
    expect(maskActiveCell(raw, null)).toBe(raw)
    expect(maskActiveCell(raw, { row: 9, col: 0 })).toBe(raw)
    expect(maskActiveCell(raw, { row: 0, col: 9 })).toBe(raw)
  })
})

describe('nextCell', () => {
  const shape: TableShape = { cols: 2, rows: 2 }

  it('Tab walks along a row', () => {
    expect(nextCell(shape, 0, 0, 'next')).toEqual({ kind: 'cell', row: 0, col: 1 })
  })

  it('Tab wraps off the end of a row onto the next row', () => {
    expect(nextCell(shape, 0, 1, 'next')).toEqual({ kind: 'cell', row: 1, col: 0 })
  })

  it('Tab off the header lands on the first data row', () => {
    expect(nextCell(shape, -1, 1, 'next')).toEqual({ kind: 'cell', row: 0, col: 0 })
  })

  it('Tab off the very last cell appends a row', () => {
    expect(nextCell(shape, 1, 1, 'next', true)).toEqual({ kind: 'append', col: 0 })
  })

  it('the same move without append leaves the table', () => {
    expect(nextCell(shape, 1, 1, 'next')).toEqual({ kind: 'exit', where: 'after' })
  })

  it('Shift-Tab wraps back onto the previous row', () => {
    expect(nextCell(shape, 1, 0, 'prev')).toEqual({ kind: 'cell', row: 0, col: 1 })
  })

  it('Shift-Tab off the first header cell leaves the table', () => {
    expect(nextCell(shape, -1, 0, 'prev')).toEqual({ kind: 'exit', where: 'before' })
  })

  it('Enter on the last row appends, keeping the column', () => {
    expect(nextCell(shape, 1, 1, 'down', true)).toEqual({ kind: 'append', col: 1 })
  })

  it('ArrowDown off the last row leaves the table', () => {
    expect(nextCell(shape, 1, 0, 'down')).toEqual({ kind: 'exit', where: 'after' })
  })

  it('ArrowUp from the first data row lands on the header', () => {
    expect(nextCell(shape, 0, 1, 'up')).toEqual({ kind: 'cell', row: -1, col: 1 })
  })

  it('ArrowUp from the header leaves the table', () => {
    expect(nextCell(shape, -1, 0, 'up')).toEqual({ kind: 'exit', where: 'before' })
  })

  it('a header-only table appends on Tab off its last cell', () => {
    expect(nextCell({ cols: 2, rows: 0 }, -1, 1, 'next', true)).toEqual({ kind: 'append', col: 0 })
  })
})
