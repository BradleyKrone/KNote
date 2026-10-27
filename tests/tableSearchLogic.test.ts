import { describe, expect, it } from 'vitest'
import { cellHighlights, cellSpans, withinOneCell } from '@/editor/tableSearchLogic'

const RAW = ['| Name | Qty |', '| --- | --: |', '| apple | 3 |', '| a \\| b | 10 |'].join('\n')

/** Raw offset of the `nth` occurrence of `needle` in RAW. */
function at(needle: string, nth = 0): number {
  let i = -1
  for (let k = 0; k <= nth; k++) i = RAW.indexOf(needle, i + 1)
  return i
}

describe('cellSpans', () => {
  it('lists header and body cells, skipping the delimiter row', () => {
    const spans = cellSpans(RAW)
    expect(spans.map((s) => `${s.row}:${s.col}`)).toEqual([
      '-1:0',
      '-1:1',
      '0:0',
      '0:1',
      '1:0',
      '1:1'
    ])
    expect(RAW.slice(spans[2].from, spans[2].to)).toBe(' apple ')
  })
})

describe('withinOneCell', () => {
  it('accepts a range inside one cell and rejects one crossing a pipe', () => {
    expect(withinOneCell(RAW, at('apple'), at('apple') + 5)).toBe(true)
    expect(withinOneCell(RAW, at('apple'), at('3') + 1)).toBe(false)
  })
  it('rejects a range on the delimiter row', () => {
    expect(withinOneCell(RAW, at('---'), at('---') + 3)).toBe(false)
  })
})

describe('cellHighlights', () => {
  it('maps a hit onto the trimmed cell text', () => {
    const from = at('ppl')
    const map = cellHighlights(RAW, [{ from, to: from + 3, selected: true }])
    expect(map.get('0:0')).toEqual([{ from: 1, to: 4, selected: true }])
  })
  it('collapses an escaped pipe the way the rendered cell does', () => {
    // Rendered text is "a | b"; a hit on "b" sits at index 4, not 5.
    const from = at('b |')
    const map = cellHighlights(RAW, [{ from, to: from + 1, selected: false }])
    expect(map.get('1:0')).toEqual([{ from: 4, to: 5, selected: false }])
  })
  it('clips a range spanning cells to each cell it covers', () => {
    const map = cellHighlights(RAW, [{ from: at('apple'), to: at('3') + 1, selected: false }])
    expect(map.get('0:0')).toEqual([{ from: 0, to: 5, selected: false }])
    expect(map.get('0:1')).toEqual([{ from: 0, to: 1, selected: false }])
  })
  it('drops a range that only covers padding or pipes', () => {
    const map = cellHighlights(RAW, [{ from: at('|', 4), to: at('|', 4) + 1, selected: false }])
    expect(map.size).toBe(0)
  })
})
