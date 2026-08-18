// Pure GFM pipe-table parsing — no CodeMirror or DOM imports, so it's
// unit-testable under vitest and shared by tableRender.ts.

export type Align = '' | 'left' | 'center' | 'right'

export interface ParsedTable {
  header: string[]
  aligns: Align[]
  rows: string[][]
  /**
   * The block's leading whitespace, taken from its first line — how a table
   * nests under a task (`indentTable` in tableEdit.ts). Carried on the model so
   * `parseTable` → transform → `serializeTable` is a true round trip: every
   * structural op rewrites the whole block, and without this an indented table
   * would spring back flush-left the first time a row or column was touched.
   */
  indent: string
}

/** Split one pipe-table row into trimmed cell strings (handles `\|` escapes). */
export function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (ch === '|') {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

/** Column alignments from a `|:--|:-:|--:|` delimiter row. */
export function parseAligns(line: string): Align[] {
  return splitRow(line).map((spec) => {
    const l = spec.startsWith(':')
    const r = spec.endsWith(':')
    if (l && r) return 'center'
    if (r) return 'right'
    if (l) return 'left'
    return ''
  })
}

/**
 * Parse a raw pipe table (header row, `---` delimiter row, then body rows)
 * into a normalized model. Blank lines are ignored; body cells are padded to
 * the header's column count so every row is rectangular.
 */
export function parseTable(raw: string): ParsedTable {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return { header: [], aligns: [], rows: [], indent: '' }

  const header = splitRow(lines[0])
  const aligns = lines.length > 1 ? parseAligns(lines[1]) : []
  const rows: string[][] = []
  for (let r = 2; r < lines.length; r++) {
    const cells = splitRow(lines[r])
    rows.push(header.map((_, i) => cells[i] ?? ''))
  }
  return { header, aligns, rows, indent: leadingWhitespace(lines[0]) }
}

/** A line's leading spaces/tabs. */
function leadingWhitespace(lineText: string): string {
  return /^[ \t]*/.exec(lineText)![0]
}

/**
 * Index just past the line's opening pipe, skipping any leading indentation
 * first — a table nested under a task (see `indentTable` in tableEdit.ts) is
 * indented with plain spaces, so the opening `|` isn't necessarily at index 0
 * the way `splitRow`'s own `line.trim()` assumes.
 */
function afterOpenPipe(lineText: string): number {
  const indent = leadingWhitespace(lineText).length
  return lineText[indent] === '|' ? indent + 1 : indent
}

/**
 * Which column a raw-text offset within one table line falls into — the same
 * pipe-walking/escape logic as `splitRow`, but returning an index instead of
 * the split cells. Used to map a click position in the "raw pipes revealed"
 * editing view back to a column.
 */
export function columnAtOffset(lineText: string, offset: number): number {
  const start = afterOpenPipe(lineText)
  let col = 0
  for (let i = start; i < offset && i < lineText.length; i++) {
    if (lineText[i] === '\\' && lineText[i + 1] === '|') {
      i++
      continue
    }
    if (lineText[i] === '|') col++
  }
  return col
}

/**
 * Character offset ranges (into `lineText`, excluding the pipes themselves) of
 * each cell on one raw table line — the same pipe-walking/escape logic as
 * `splitRow`, but returning positions instead of the split cells. Used to lay
 * fixed-width decorations over a table's raw text so it keeps its column
 * alignment while being typed into, instead of drifting with the raw pipes.
 */
export function cellOffsets(lineText: string): Array<{ from: number; to: number }> {
  const start = afterOpenPipe(lineText)
  const end =
    lineText.endsWith('|') && !lineText.endsWith('\\|') ? lineText.length - 1 : lineText.length
  const ranges: Array<{ from: number; to: number }> = []
  let cellStart = start
  for (let i = start; i < end; i++) {
    if (lineText[i] === '\\' && lineText[i + 1] === '|') {
      i++
      continue
    }
    if (lineText[i] === '|') {
      ranges.push({ from: cellStart, to: i })
      cellStart = i + 1
    }
  }
  ranges.push({ from: cellStart, to: end })
  return ranges
}

/** Re-escape a literal `|` for writing back out (splitRow unescapes `\|` on read). */
export function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

/**
 * Make arbitrary typed/pasted text safe to hold in one cell of the model: a
 * cell is a single line, so line breaks collapse to spaces. Pipes are *not*
 * escaped here — the model holds unescaped text (splitRow unescapes on read)
 * and `escapeCell`/`serializeTable` re-escape on the way back out.
 *
 * Keeping cell text single-line is what lets an in-place cell edit be written
 * back as a one-line replacement; a stray `\n` would split the table row in two
 * and is exactly the class of edit the CRLF rules in @shared/editorSync exist
 * to keep off the wire.
 */
export function sanitizeCellText(text: string): string {
  return text.replace(/\r/g, '').replace(/\n/g, ' ')
}

/** Each column's display width (in characters, min 3) — the widest escaped cell in it. */
export function columnWidths(table: ParsedTable): number[] {
  return table.header.map((h, i) => {
    let w = Math.max(3, escapeCell(h).length)
    for (const row of table.rows) w = Math.max(w, escapeCell(row[i] ?? '').length)
    return w
  })
}

function alignDelim(align: Align, width: number): string {
  const dashes = '-'.repeat(
    Math.max(
      width - (align === 'left' || align === 'right' ? 1 : 0) - (align === 'center' ? 2 : 0),
      3
    )
  )
  if (align === 'center') return `:${dashes}:`
  if (align === 'right') return `${dashes}:`
  if (align === 'left') return `:${dashes}`
  return dashes
}

/**
 * Serialize a table model back to raw pipe-table markdown, padding every
 * column to its widest cell (min width 3) so columns line up when the raw
 * pipes are shown in the editing view. Every line carries the block's own
 * `indent`, so rewriting a table nested under a task keeps it nested.
 */
export function serializeTable(table: ParsedTable): string {
  const { header, aligns, rows, indent } = table
  const widths = columnWidths(table)
  const pad = (cells: string[]): string =>
    indent + '| ' + cells.map((c, i) => escapeCell(c ?? '').padEnd(widths[i])).join(' | ') + ' |'

  const lines: string[] = []
  lines.push(pad(header))
  lines.push(
    indent + '| ' + widths.map((w, i) => alignDelim(aligns[i] ?? '', w)).join(' | ') + ' |'
  )
  for (const row of rows) lines.push(pad(header.map((_, i) => row[i] ?? '')))
  return lines.join('\n')
}

/**
 * One blank data row, padded to the table's current column widths — appended
 * verbatim when Tab or Enter runs off the bottom of a table. Appending a line
 * rather than re-serializing the whole table keeps every other row byte-identical,
 * so growing a table can never trip parseTable's drop-the-extra-cells behavior.
 */
export function blankRowSource(table: ParsedTable): string {
  return (
    table.indent +
    '| ' +
    columnWidths(table)
      .map((w) => ' '.repeat(w))
      .join(' | ') +
    ' |'
  )
}

/** Build a brand-new blank table's raw source: `Column 1..N` headers, `rows` blank data rows. */
export function emptyTableSource(rows: number, cols: number): string {
  const header = Array.from({ length: cols }, (_, i) => `Column ${i + 1}`)
  const aligns: Align[] = Array.from({ length: cols }, () => '')
  const body = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''))
  return serializeTable({ header, aligns, rows: body, indent: '' })
}

/** Insert a blank data row at `atIndex` (0-based; `rows.length` appends). */
export function insertTableRow(table: ParsedTable, atIndex: number): ParsedTable {
  const blank = table.header.map(() => '')
  const rows = table.rows.slice()
  rows.splice(atIndex, 0, blank)
  return { ...table, rows }
}

/** Remove the data row at `atIndex`. No-op if out of range. */
export function removeTableRow(table: ParsedTable, atIndex: number): ParsedTable {
  if (atIndex < 0 || atIndex >= table.rows.length) return table
  const rows = table.rows.slice()
  rows.splice(atIndex, 1)
  return { ...table, rows }
}

/** Insert a blank column at `atIndex` (0-based; `header.length` appends). */
export function insertTableColumn(table: ParsedTable, atIndex: number): ParsedTable {
  const header = table.header.slice()
  header.splice(atIndex, 0, `Column ${header.length + 1}`)
  const aligns = table.aligns.slice()
  aligns.splice(atIndex, 0, '')
  const rows = table.rows.map((row) => {
    const r = row.slice()
    r.splice(atIndex, 0, '')
    return r
  })
  return { ...table, header, aligns, rows }
}

/** Remove the column at `atIndex`. No-op if it's the only column or out of range. */
export function removeTableColumn(table: ParsedTable, atIndex: number): ParsedTable {
  if (table.header.length <= 1 || atIndex < 0 || atIndex >= table.header.length) return table
  const header = table.header.slice()
  header.splice(atIndex, 1)
  const aligns = table.aligns.slice()
  aligns.splice(atIndex, 1)
  const rows = table.rows.map((row) => {
    const r = row.slice()
    r.splice(atIndex, 1)
    return r
  })
  return { ...table, header, aligns, rows }
}

/** Set one column's alignment. Out-of-range `colIndex` is a no-op. */
export function setColumnAlign(table: ParsedTable, colIndex: number, align: Align): ParsedTable {
  if (colIndex < 0 || colIndex >= table.header.length) return table
  const aligns = table.aligns.slice()
  aligns[colIndex] = align
  return { ...table, aligns }
}

/**
 * Replace one cell's text. `rowIndex` is -1 for the header, otherwise a 0-based
 * index into `rows`. Out-of-range coordinates are a no-op, so callers can hand
 * over stale coordinates without checking first.
 */
export function setCell(
  table: ParsedTable,
  rowIndex: number,
  colIndex: number,
  value: string
): ParsedTable {
  if (colIndex < 0 || colIndex >= table.header.length) return table
  const text = sanitizeCellText(value)
  if (rowIndex < 0) {
    const header = table.header.slice()
    header[colIndex] = text
    return { ...table, header }
  }
  if (rowIndex >= table.rows.length) return table
  const rows = table.rows.slice()
  const row = rows[rowIndex].slice()
  row[colIndex] = text
  rows[rowIndex] = row
  return { ...table, rows }
}

/**
 * Read clipboard text as a grid of cells for a multi-cell paste — tab-separated
 * columns, line-separated rows, the shape every spreadsheet puts on the
 * clipboard. Returns null for anything that isn't a grid (a single line with no
 * tabs), so the caller can fall through to an ordinary in-cell paste.
 */
export function parseGridText(text: string): string[][] | null {
  const stripped = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '')
  if (stripped === '') return null
  if (!stripped.includes('\t') && !stripped.includes('\n')) return null
  return stripped.split('\n').map((line) => line.split('\t').map(sanitizeCellText))
}

/**
 * Write `grid` into the table with its top-left corner at (`rowIndex`,
 * `colIndex`), growing the table with blank rows/columns as needed so nothing
 * pasted is dropped. `rowIndex` -1 starts at the header row.
 */
export function pasteGrid(
  table: ParsedTable,
  rowIndex: number,
  colIndex: number,
  grid: string[][]
): ParsedTable {
  if (grid.length === 0) return table
  const width = Math.max(...grid.map((r) => r.length))
  let out = table
  while (out.header.length < colIndex + width) out = insertTableColumn(out, out.header.length)
  const lastRow = rowIndex + grid.length - 1
  while (out.rows.length <= lastRow) out = insertTableRow(out, out.rows.length)
  grid.forEach((cells, r) => {
    cells.forEach((cell, c) => {
      out = setCell(out, rowIndex + r, colIndex + c, cell)
    })
  })
  return out
}

/**
 * Whether `raw` survives a parseTable → serializeTable round trip unchanged in
 * content. It doesn't when a row carries more cells than the header does (GFM
 * says to drop the extras, and parseTable duly does) or when the delimiter row
 * is wider than the header. Re-padding a table is only safe when this holds —
 * otherwise merely typing in a cell would silently delete the extra cells.
 */
export function roundTripsLossless(raw: string): boolean {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length < 2) return false
  const cols = splitRow(lines[0]).length
  if (splitRow(lines[1]).length > cols) return false
  for (let r = 2; r < lines.length; r++) if (splitRow(lines[r]).length > cols) return false
  return true
}
