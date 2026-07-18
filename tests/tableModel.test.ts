import { describe, expect, it } from 'vitest'
import { parseAligns, parseTable, splitRow } from '@/editor/tableModel'

describe('splitRow', () => {
  it('splits a padded pipe row into trimmed cells', () => {
    expect(splitRow('| Name | Qty |')).toEqual(['Name', 'Qty'])
  })
  it('handles rows without outer pipes', () => {
    expect(splitRow('a | b | c')).toEqual(['a', 'b', 'c'])
  })
  it('keeps escaped pipes inside a cell', () => {
    expect(splitRow('| a \\| b | c |')).toEqual(['a | b', 'c'])
  })
})

describe('parseAligns', () => {
  it('reads left / center / right / default from the delimiter row', () => {
    expect(parseAligns('| :--- | :--: | ---: | --- |')).toEqual(['left', 'center', 'right', ''])
  })
})

describe('parseTable', () => {
  it('parses header, alignments and body rows', () => {
    const raw = ['| Name | Qty |', '|------|----:|', '| Bolt | 12 |', '| Nut  | 3  |'].join('\n')
    expect(parseTable(raw)).toEqual({
      header: ['Name', 'Qty'],
      aligns: ['', 'right'],
      rows: [
        ['Bolt', '12'],
        ['Nut', '3']
      ]
    })
  })

  it('pads short rows to the header column count', () => {
    const raw = ['| A | B | C |', '|---|---|---|', '| 1 | 2 |'].join('\n')
    expect(parseTable(raw).rows).toEqual([['1', '2', '']])
  })

  it('ignores blank lines and tolerates a header-only table', () => {
    expect(parseTable('| A | B |\n')).toEqual({ header: ['A', 'B'], aligns: [], rows: [] })
  })

  it('returns an empty model for empty input', () => {
    expect(parseTable('')).toEqual({ header: [], aligns: [], rows: [] })
  })
})
