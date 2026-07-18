// Pure GFM pipe-table parsing — no CodeMirror or DOM imports, so it's
// unit-testable under vitest and shared by tableRender.ts.

export type Align = '' | 'left' | 'center' | 'right'

export interface ParsedTable {
  header: string[]
  aligns: Align[]
  rows: string[][]
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
  if (lines.length === 0) return { header: [], aligns: [], rows: [] }

  const header = splitRow(lines[0])
  const aligns = lines.length > 1 ? parseAligns(lines[1]) : []
  const rows: string[][] = []
  for (let r = 2; r < lines.length; r++) {
    const cells = splitRow(lines[r])
    rows.push(header.map((_, i) => cells[i] ?? ''))
  }
  return { header, aligns, rows }
}
