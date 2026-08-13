import { describe, expect, it } from 'vitest'
import {
  blankRowSource,
  cellOffsets,
  columnAtOffset,
  columnWidths,
  emptyTableSource,
  escapeCell,
  insertTableColumn,
  insertTableRow,
  parseAligns,
  parseGridText,
  parseTable,
  pasteGrid,
  removeTableColumn,
  removeTableRow,
  roundTripsLossless,
  sanitizeCellText,
  serializeTable,
  setCell,
  splitRow,
  type ParsedTable
} from '@/editor/tableModel'

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
      ],
      indent: ''
    })
  })

  it('pads short rows to the header column count', () => {
    const raw = ['| A | B | C |', '|---|---|---|', '| 1 | 2 |'].join('\n')
    expect(parseTable(raw).rows).toEqual([['1', '2', '']])
  })

  it('ignores blank lines and tolerates a header-only table', () => {
    expect(parseTable('| A | B |\n')).toEqual({
      header: ['A', 'B'],
      aligns: [],
      rows: [],
      indent: ''
    })
  })

  it('returns an empty model for empty input', () => {
    expect(parseTable('')).toEqual({ header: [], aligns: [], rows: [], indent: '' })
  })

  // A table nested under a task (indentTable in tableEdit.ts) keeps its
  // indentation on the model, so a structural rewrite puts it back — without
  // this, the first insert-row would spring the table flush-left again.
  it('records the block’s leading indentation', () => {
    const raw = ['  | A | B |', '  |---|---|', '  | 1 | 2 |'].join('\n')
    expect(parseTable(raw)).toEqual({
      header: ['A', 'B'],
      aligns: ['', ''],
      rows: [['1', '2']],
      indent: '  '
    })
  })
})

describe('columnAtOffset', () => {
  const line = '| Name | Qty |'
  it('maps an offset in the first cell to column 0', () => {
    expect(columnAtOffset(line, 3)).toBe(0)
  })
  it('maps an offset past the first pipe boundary to column 1', () => {
    expect(columnAtOffset(line, line.indexOf('Qty'))).toBe(1)
  })
  it('does not count an escaped pipe as a column boundary', () => {
    const escaped = '| a \\| b | c |'
    expect(columnAtOffset(escaped, escaped.indexOf('c'))).toBe(1)
  })

  // Regression: indentTable (tableEdit.ts) nests a table under a task by
  // adding plain leading spaces to its raw lines. Before this, the leading
  // whitespace meant `startsWith('|')` never matched, so the loop counted the
  // table's own opening pipe as a column boundary and every column on an
  // indented line resolved one too high — a right-click on the first cell of
  // an indented table would silently act on the second column instead.
  it('skips leading indentation before the opening pipe', () => {
    const indented = '    | Name | Qty |'
    expect(columnAtOffset(indented, indented.indexOf('Name'))).toBe(0)
    expect(columnAtOffset(indented, indented.indexOf('Qty'))).toBe(1)
  })
})

describe('cellOffsets', () => {
  it('returns the from/to range of each cell, excluding the pipes', () => {
    const line = '| Name | Qty |'
    expect(cellOffsets(line).map((r) => line.slice(r.from, r.to))).toEqual([' Name ', ' Qty '])
  })
  it('keeps an escaped pipe inside its cell range', () => {
    const line = '| a \\| b | c |'
    expect(cellOffsets(line).map((r) => line.slice(r.from, r.to))).toEqual([' a \\| b ', ' c '])
  })
  it('handles rows without outer pipes', () => {
    const line = 'a | b | c'
    expect(cellOffsets(line).map((r) => line.slice(r.from, r.to))).toEqual(['a ', ' b ', ' c'])
  })

  it('skips leading indentation before the opening pipe (indentTable nesting)', () => {
    const indented = '    | Name | Qty |'
    expect(cellOffsets(indented).map((r) => indented.slice(r.from, r.to))).toEqual([
      ' Name ',
      ' Qty '
    ])
  })
})

describe('columnWidths', () => {
  it('is the widest escaped cell per column, minimum 3', () => {
    const table: ParsedTable = {
      header: ['Name', 'Q'],
      aligns: ['', ''],
      rows: [['Bolt', '12']],
      indent: ''
    }
    expect(columnWidths(table)).toEqual([4, 3])
  })
  it('accounts for the extra backslash width of an escaped pipe', () => {
    const table: ParsedTable = { header: ['A'], aligns: [''], rows: [['a|b']], indent: '' }
    expect(columnWidths(table)).toEqual([4]) // "a\|b" is 4 chars once escaped
  })
})

describe('serializeTable', () => {
  it('pads columns to their widest cell and emits a dash delimiter', () => {
    const table: ParsedTable = {
      header: ['Name', 'Qty'],
      aligns: ['', ''],
      rows: [['Bolt', '12']],
      indent: ''
    }
    expect(serializeTable(table)).toBe(
      ['| Name | Qty |', '| ---- | --- |', '| Bolt | 12  |'].join('\n')
    )
  })

  it('encodes left / center / right alignment back into the delimiter row', () => {
    const table: ParsedTable = {
      header: ['A', 'B', 'C'],
      aligns: ['left', 'center', 'right'],
      rows: [],
      indent: ''
    }
    const lines = serializeTable(table).split('\n')
    expect(parseAligns(lines[1])).toEqual(['left', 'center', 'right'])
  })

  it('escapes a literal pipe in a cell so it round-trips through parseTable', () => {
    const table: ParsedTable = { header: ['A'], aligns: [''], rows: [['a | b']], indent: '' }
    const raw = serializeTable(table)
    expect(parseTable(raw).rows).toEqual([['a | b']])
  })

  it('serializes a header-only (0-row) table', () => {
    const table: ParsedTable = { header: ['A', 'B'], aligns: ['', ''], rows: [], indent: '' }
    expect(parseTable(serializeTable(table))).toEqual(table)
  })

  it('round-trips through parseTable/serializeTable idempotently', () => {
    const raw = ['| Name | Qty |', '|:-----|----:|', '| Bolt | 12 |', '| Nut  | 3  |'].join('\n')
    const once = serializeTable(parseTable(raw))
    const twice = serializeTable(parseTable(once))
    expect(twice).toBe(once)
  })
})

describe('blankRowSource', () => {
  it('is a blank row padded to the table’s column widths', () => {
    const table: ParsedTable = {
      header: ['Name', 'Qty'],
      aligns: ['', ''],
      rows: [['Bolt', '12']],
      indent: ''
    }
    expect(blankRowSource(table)).toBe('|      |     |')
  })

  it('appends onto a table without disturbing the existing rows', () => {
    const raw = ['| Name | Qty |', '| ---- | --- |', '| Bolt | 12  |'].join('\n')
    const grown = raw + '\n' + blankRowSource(parseTable(raw))
    expect(parseTable(grown).rows).toEqual([
      ['Bolt', '12'],
      ['', '']
    ])
    expect(grown.startsWith(raw)).toBe(true)
  })
})

describe('emptyTableSource', () => {
  it('builds a blank table with numbered headers and the requested shape', () => {
    expect(parseTable(emptyTableSource(2, 3))).toEqual({
      header: ['Column 1', 'Column 2', 'Column 3'],
      aligns: ['', '', ''],
      rows: [
        ['', '', ''],
        ['', '', '']
      ],
      indent: ''
    })
  })
})

describe('insertTableRow / removeTableRow', () => {
  const table: ParsedTable = {
    header: ['A', 'B'],
    aligns: ['', ''],
    rows: [
      ['1', '2'],
      ['3', '4']
    ],
    indent: ''
  }

  it('inserts a blank row at the given index', () => {
    expect(insertTableRow(table, 1).rows).toEqual([
      ['1', '2'],
      ['', ''],
      ['3', '4']
    ])
  })

  it('appends when the index is rows.length', () => {
    expect(insertTableRow(table, 2).rows).toEqual([
      ['1', '2'],
      ['3', '4'],
      ['', '']
    ])
  })

  it('removes the row at the given index', () => {
    expect(removeTableRow(table, 0).rows).toEqual([['3', '4']])
  })

  it('removing the last data row leaves a valid header-only table', () => {
    const oneRow: ParsedTable = { header: ['A'], aligns: [''], rows: [['1']], indent: '' }
    expect(removeTableRow(oneRow, 0)).toEqual({
      header: ['A'],
      aligns: [''],
      rows: [],
      indent: ''
    })
  })

  it('is a no-op when the index is out of range', () => {
    expect(removeTableRow(table, 5)).toEqual(table)
  })
})

describe('insertTableColumn / removeTableColumn', () => {
  const table: ParsedTable = {
    header: ['A', 'B'],
    aligns: ['left', 'right'],
    rows: [['1', '2']],
    indent: ''
  }

  it('inserts a blank column at the given index', () => {
    expect(insertTableColumn(table, 1)).toEqual({
      header: ['A', 'Column 3', 'B'],
      aligns: ['left', '', 'right'],
      rows: [['1', '', '2']],
      indent: ''
    })
  })

  it('removes the column at the given index', () => {
    expect(removeTableColumn(table, 0)).toEqual({
      header: ['B'],
      aligns: ['right'],
      rows: [['2']],
      indent: ''
    })
  })

  it('refuses to remove the last remaining column', () => {
    const oneCol: ParsedTable = { header: ['A'], aligns: [''], rows: [['1']], indent: '' }
    expect(removeTableColumn(oneCol, 0)).toEqual(oneCol)
  })
})

describe('escapeCell / sanitizeCellText', () => {
  it('escapes a literal pipe on the way back out', () => {
    expect(escapeCell('a | b')).toBe('a \\| b')
  })

  it('collapses line breaks to spaces so a cell stays one line', () => {
    expect(sanitizeCellText('a\r\nb\nc')).toBe('a b c')
  })

  it('leaves pipes unescaped — the model holds unescaped text', () => {
    expect(sanitizeCellText('a | b')).toBe('a | b')
  })
})

describe('setCell', () => {
  const table: ParsedTable = {
    header: ['A', 'B'],
    aligns: ['', ''],
    rows: [
      ['1', '2'],
      ['3', '4']
    ],
    indent: ''
  }

  it('replaces a body cell without touching the others', () => {
    expect(setCell(table, 1, 0, 'x').rows).toEqual([
      ['1', '2'],
      ['x', '4']
    ])
  })

  it('replaces a header cell when rowIndex is -1', () => {
    const out = setCell(table, -1, 1, 'Qty')
    expect(out.header).toEqual(['A', 'Qty'])
    expect(out.rows).toEqual(table.rows)
  })

  it('sanitizes the value it stores', () => {
    expect(setCell(table, 0, 0, 'one\ntwo').rows[0][0]).toBe('one two')
  })

  it('is a no-op for out-of-range coordinates', () => {
    expect(setCell(table, 9, 0, 'x')).toEqual(table)
    expect(setCell(table, 0, 9, 'x')).toEqual(table)
  })
})

describe('parseGridText', () => {
  it('reads tab-separated, line-separated clipboard text as a grid', () => {
    expect(parseGridText('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ])
  })

  it('normalizes CRLF and ignores a trailing newline', () => {
    expect(parseGridText('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ])
  })

  it('returns null for single-cell text so an ordinary paste can proceed', () => {
    expect(parseGridText('just some words')).toBeNull()
    expect(parseGridText('')).toBeNull()
  })

  it('treats a single multi-line paste as a one-column grid', () => {
    expect(parseGridText('a\nb')).toEqual([['a'], ['b']])
  })
})

describe('pasteGrid', () => {
  const table: ParsedTable = {
    header: ['A', 'B'],
    aligns: ['', ''],
    rows: [['1', '2']],
    indent: ''
  }

  it('fills cells from the given corner, leaving the rest alone', () => {
    const out = pasteGrid(table, 0, 0, [['x', 'y']])
    expect(out.header).toEqual(['A', 'B'])
    expect(out.rows).toEqual([['x', 'y']])
  })

  it('grows rows and columns so nothing pasted is dropped', () => {
    const out = pasteGrid(table, 0, 1, [
      ['x', 'y'],
      ['z', 'w']
    ])
    expect(out.header).toEqual(['A', 'B', 'Column 3'])
    expect(out.rows).toEqual([
      ['1', 'x', 'y'],
      ['', 'z', 'w']
    ])
  })

  it('pastes into the header row when rowIndex is -1', () => {
    const out = pasteGrid(table, -1, 0, [
      ['H1', 'H2'],
      ['x', 'y']
    ])
    expect(out.header).toEqual(['H1', 'H2'])
    expect(out.rows).toEqual([['x', 'y']])
  })

  it('is a no-op for an empty grid', () => {
    expect(pasteGrid(table, 0, 0, [])).toEqual(table)
  })
})

describe('roundTripsLossless', () => {
  it('is true for a well-formed table', () => {
    const raw = ['| A | B |', '| - | - |', '| 1 | 2 |'].join('\n')
    expect(roundTripsLossless(raw)).toBe(true)
  })

  it('is true when a row is short — parseTable pads those back out', () => {
    const raw = ['| A | B |', '| - | - |', '| 1 |'].join('\n')
    expect(roundTripsLossless(raw)).toBe(true)
  })

  it('is false when a row carries more cells than the header', () => {
    const raw = ['| A | B |', '| - | - |', '| 1 | 2 | 3 |'].join('\n')
    expect(roundTripsLossless(raw)).toBe(false)
  })

  it('is false when the delimiter row is wider than the header', () => {
    const raw = ['| A | B |', '| - | - | - |', '| 1 | 2 |'].join('\n')
    expect(roundTripsLossless(raw)).toBe(false)
  })

  it('is false for a header-only fragment with no delimiter row', () => {
    expect(roundTripsLossless('| A | B |')).toBe(false)
  })
})
