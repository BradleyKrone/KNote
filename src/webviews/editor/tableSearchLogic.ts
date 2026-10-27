// Pure half of find-in-table (tableRender.ts): maps document ranges — search
// hits, the selected match — onto the cells of a *rendered* table, so Ctrl+F
// can highlight inside the grid instead of dropping it back to raw pipes.
// No DOM or CodeMirror imports, so vitest can drive it directly.

import { cellOffsets } from './tableModel'

/** A highlight within one rendered cell's text (the trimmed, `\|`-unescaped string `parseTable` yields). */
export interface CellHighlight {
  from: number
  to: number
  /** The current match (or the selection) — drawn stronger than the rest. */
  selected: boolean
}

/** A range to highlight, as offsets into the table's raw block text. */
export interface RawHighlight {
  from: number
  to: number
  selected: boolean
}

/** One cell's raw source span (pipes excluded) within the block text. */
export interface CellSpan {
  /** Model row: -1 for the header, 0.. for body rows. */
  row: number
  col: number
  from: number
  to: number
}

/**
 * Every cell's raw span in a table block — the header and body rows, skipping
 * the delimiter row, and dropping cells past the header's column count (which
 * `parseTable` drops too, so they're never rendered).
 */
export function cellSpans(raw: string): CellSpan[] {
  const spans: CellSpan[] = []
  const lines = raw.split('\n')
  let lineStart = 0
  let columns = 0
  lines.forEach((text, idx) => {
    if (idx !== 1) {
      const cells = cellOffsets(text)
      if (idx === 0) columns = cells.length
      const row = idx === 0 ? -1 : idx - 2
      cells.slice(0, columns).forEach((c, col) => {
        spans.push({ row, col, from: lineStart + c.from, to: lineStart + c.to })
      })
    }
    lineStart += text.length + 1
  })
  return spans
}

/** Whether a raw range lies wholly inside one cell — i.e. can be shown as a highlight in the rendered grid. */
export function withinOneCell(raw: string, from: number, to: number): boolean {
  return cellSpans(raw).some((s) => s.from <= from && to <= s.to)
}

/**
 * Map an offset into a cell's raw source onto the rendered cell text: leading
 * whitespace is trimmed and `\|` collapses to `|`, exactly as `splitRow` does.
 */
function renderedOffset(src: string, offset: number): number {
  const lead = /^\s*/.exec(src)![0].length
  const textLen = src.replace(/\\\|/g, '|').trim().length
  let out = 0
  for (let i = lead; i < offset && i < src.length; i++) {
    if (src[i] === '\\' && src[i + 1] === '|') i++
    out++
  }
  return Math.min(out, textLen)
}

/**
 * Clip each raw highlight to the cells it overlaps and translate it into that
 * cell's rendered-text offsets. Keyed `"row:col"`; empty results are dropped.
 */
export function cellHighlights(
  raw: string,
  ranges: readonly RawHighlight[]
): Map<string, CellHighlight[]> {
  const out = new Map<string, CellHighlight[]>()
  if (ranges.length === 0) return out
  for (const span of cellSpans(raw)) {
    const src = raw.slice(span.from, span.to)
    for (const r of ranges) {
      const from = Math.max(r.from, span.from)
      const to = Math.min(r.to, span.to)
      if (from >= to) continue
      const a = renderedOffset(src, from - span.from)
      const b = renderedOffset(src, to - span.from)
      if (a >= b) continue
      const key = `${span.row}:${span.col}`
      const list = out.get(key) ?? []
      list.push({ from: a, to: b, selected: r.selected })
      out.set(key, list)
    }
  }
  return out
}
