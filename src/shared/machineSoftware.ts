// Shape of a 🚜 machine work-log entry's detail block — the software table
// under the entry recording what was on the machine and what was flashed.
// Shared by the parser (which reads it back into MachineLogItem.software), the
// native-editor insert command, the live-preview editor's right-click insert /
// edit, and the Machine Log view's right-click edit. Pure data + string
// building, no vscode/CodeMirror imports.
//
//   🚜 Z6A00101 📅 2026-09-24 Flashed display
//   | Software  | Base  | Flashed |
//   | --------- | ----- | ------- |
//   | Implement |       |         |
//   | EC520     | 2.2.0 |         |
//   | Machine   | 1.2.3 | 1.4.0   |
//   | Display   | 4.0.1 | 4.1.0   |
//   - Notes:
//
// A table can interrupt a paragraph in both CommonMark-GFM parsers KNote uses
// (Lezer in Live Preview, markdown-it in Reading mode), so it sits straight
// under the 🚜 line with no blank line — which is what lets the entry own it.
//
// Entries written briefly before the table existed carry two nested-list
// sections instead (`- Base Machine Software:` / `- Software Flashed:` with a
// `  - Kind: version` line each). Those still read, and the first edit through
// the popup swaps them for the table.

import type { MachineSoftwareItem } from './types'
import { MACHINE_ENTRY_RE } from './parser/patterns'

export const SOFTWARE_KINDS = ['Implement', 'EC520', 'Machine', 'Display'] as const
export type SoftwareKind = (typeof SOFTWARE_KINDS)[number]

/** `base` = what was on the machine before; `flashed` = what was put on it. */
export type SoftwareSection = 'base' | 'flashed'
export const SOFTWARE_SECTIONS: readonly SoftwareSection[] = ['base', 'flashed']

/** Each section's column heading (and popup label). */
export const SECTION_LABELS: Record<SoftwareSection, string> = {
  base: 'Base',
  flashed: 'Flashed'
}

/** One section's value per software kind — '' when not recorded. */
export type SoftwareSet = Record<SoftwareKind, string>
export type MachineSoftware = Record<SoftwareSection, SoftwareSet>

const TABLE_ROW_RE = /^\s*\|/
const TABLE_HEADER_RE = /^\s*\|\s*software\s*\|\s*base\s*\|\s*flashed\s*\|?\s*$/i
const TABLE_DELIM_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/** Legacy nested-list section header; anything after the colon makes it free text instead. */
const LEGACY_HEADER_RE =
  /^(\s*)[-*+]\s+(base machine software|base software|software flashed|flashed software|flashed)\s*:\s*$/i
const LEGACY_ITEM_RE = /^\s*[-*+]\s+(Implement|EC520|Machine|Display)\s*:[ \t]*(.*?)\s*$/i

const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s/
const LIST_MARKER_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+/
const CHECKBOX_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[.\]/
const HEADING_RE = /^\s{0,3}#{1,6}(?:\s|$)/

const indentOf = (line: string): number => /^\s*/.exec(line)![0].length
const clean = (line: string): string => line.replace(/\r$/, '')

function kindOf(label: string): SoftwareKind | undefined {
  return SOFTWARE_KINDS.find((k) => k.toLowerCase() === label.trim().toLowerCase())
}

export function emptySoftwareSet(): SoftwareSet {
  return { Implement: '', EC520: '', Machine: '', Display: '' }
}

export function emptySoftware(): MachineSoftware {
  return { base: emptySoftwareSet(), flashed: emptySoftwareSet() }
}

/**
 * One past the last line a 🚜 entry owns: the run of lines straight after it
 * that are table rows, list items, or indented deeper than it. A blank line, a
 * heading, another 🚜 entry, or a checkbox at the entry's own depth ends it.
 */
export function machineDetailEnd(lines: readonly string[], entryLine: number): number {
  const entryIndent = indentOf(clean(lines[entryLine] ?? ''))
  let i = entryLine + 1
  for (; i < lines.length; i++) {
    const l = clean(lines[i])
    if (l.trim() === '' || HEADING_RE.test(l) || MACHINE_ENTRY_RE.test(l)) break
    if (TABLE_ROW_RE.test(l)) continue
    const indent = indentOf(l)
    if (indent <= entryIndent && (CHECKBOX_RE.test(l) || !LIST_ITEM_RE.test(l))) break
  }
  return i
}

/** The 🚜 entry whose block contains `line` (the entry line itself included), or null. */
export function owningMachineEntry(lines: readonly string[], line: number): number | null {
  for (let i = line; i >= 0; i--) {
    const l = clean(lines[i])
    if (MACHINE_ENTRY_RE.test(l)) return i === line || machineDetailEnd(lines, i) > line ? i : null
    if (l.trim() === '' || HEADING_RE.test(l)) return null
  }
  return null
}

/** A table row's cells, split on unescaped pipes and unescaped back to plain text. */
function tableCells(row: string): string[] {
  let body = row.trim()
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1)
  return body.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

const escapeCell = (value: string): string => value.trim().replace(/\|/g, '\\|')

interface SoftwareTable {
  /** Header line; the table runs header..last inclusive */
  start: number
  last: number
  items: MachineSoftwareItem[]
  /** Rows naming no known kind — kept, verbatim, when the table is rewritten */
  extraRows: string[][]
}

function findTable(lines: readonly string[], entryLine: number, end: number): SoftwareTable | null {
  for (let i = entryLine + 1; i < end; i++) {
    if (!TABLE_HEADER_RE.test(clean(lines[i]))) continue
    const table: SoftwareTable = { start: i, last: i, items: [], extraRows: [] }
    let j = i + 1
    if (j < end && TABLE_DELIM_RE.test(clean(lines[j]))) j++
    for (; j < end && TABLE_ROW_RE.test(clean(lines[j])); j++) {
      table.last = j
      const rawLine = clean(lines[j])
      const cells = tableCells(rawLine)
      const kind = kindOf(cells[0] ?? '')
      if (!kind || table.items.some((it) => it.kind === kind)) {
        table.extraRows.push(cells)
        continue
      }
      table.items.push({ kind, section: 'base', value: cells[1] ?? '', line: j, rawLine })
      table.items.push({ kind, section: 'flashed', value: cells[2] ?? '', line: j, rawLine })
    }
    table.last = Math.max(table.last, j - 1)
    return table
  }
  return null
}

interface LegacySections {
  /** Every line the two sections span (headers + their items), for replacement */
  lines: number[]
  items: MachineSoftwareItem[]
}

function findLegacySections(
  lines: readonly string[],
  entryLine: number,
  end: number
): LegacySections {
  const found: LegacySections = { lines: [], items: [] }
  const seen = new Set<SoftwareSection>()
  let current: { section: SoftwareSection; indent: number } | null = null
  for (let i = entryLine + 1; i < end; i++) {
    const l = clean(lines[i])
    const indent = indentOf(l)
    if (current && indent <= current.indent) current = null
    const header = LEGACY_HEADER_RE.exec(l)
    if (header) {
      const section: SoftwareSection = header[2].toLowerCase().startsWith('base')
        ? 'base'
        : 'flashed'
      if (!seen.has(section)) {
        seen.add(section)
        current = { section, indent }
        found.lines.push(i)
      }
      continue
    }
    if (!current) continue
    found.lines.push(i)
    const item = LEGACY_ITEM_RE.exec(l)
    const kind = item && kindOf(item[1])
    const section = current.section
    if (!kind || found.items.some((it) => it.section === section && it.kind === kind)) continue
    found.items.push({ kind, section, value: item[2], line: i, rawLine: l })
  }
  return found
}

/**
 * The software recorded under a 🚜 entry — from its table, else from the
 * legacy list sections. `end` defaults to `machineDetailEnd`; the parser
 * passes one computed on code-masked lines instead.
 */
export function parseMachineDetail(
  lines: readonly string[],
  entryLine: number,
  end = machineDetailEnd(lines, entryLine)
): MachineSoftwareItem[] {
  const table = findTable(lines, entryLine, end)
  return table ? table.items : findLegacySections(lines, entryLine, end).items
}

/** Collapse parsed software lines into both sections' per-kind values. */
export function softwareFromItems(items: readonly MachineSoftwareItem[]): MachineSoftware {
  const software = emptySoftware()
  for (const item of items) software[item.section][item.kind] = item.value
  return software
}

/** The column content lines under an entry start at: past its list marker, if it has one. */
function contentIndent(entryLine: string): string {
  const m = LIST_MARKER_RE.exec(entryLine)
  return ' '.repeat(m ? m[0].length : indentOf(entryLine))
}

/** The software table, columns padded so it lines up in plain text too. */
export function softwareTableLines(
  software: MachineSoftware,
  indent = '',
  extraRows: string[][] = []
): string[] {
  const rows = [
    ...SOFTWARE_KINDS.map((k) => [k, software.base[k], software.flashed[k]].map(escapeCell)),
    ...extraRows.map((cells) => cells.map(escapeCell))
  ]
  const header = ['Software', SECTION_LABELS.base, SECTION_LABELS.flashed]
  const widths = header.map((h, c) =>
    Math.max(h.length, 3, ...rows.map((r) => (r[c] ?? '').length))
  )
  const row = (cells: string[]): string =>
    `${indent}| ${widths.map((w, c) => (cells[c] ?? '').padEnd(w)).join(' | ')} |`
  return [
    row(header),
    `${indent}| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`,
    ...rows.map(row)
  ]
}

/** The detail lines under a new machine entry, pre-filled with `software` when given. */
export function machineDetailLines(software: MachineSoftware = emptySoftware()): string[] {
  return [...softwareTableLines(software), '- Notes: ']
}

/** The detail template appended under a new machine entry (a leading newline per line). */
export function machineEntryTemplate(software?: MachineSoftware): string {
  return machineDetailLines(software)
    .map((l) => `\n${l}`)
    .join('')
}

/** A contiguous run of lines to swap: `lines[from..to)` becomes `next`. */
export interface BlockEdit {
  from: number
  to: number
  /** The lines being replaced, exactly as planned against — the write's staleness check */
  expected: string[]
  next: string[]
}

/**
 * The single block edit that makes a 🚜 entry say `entryText` on its own line
 * and record `software` below it — or null when nothing would change.
 *
 * An existing software table is rewritten whole (rows for unknown kinds kept);
 * legacy list sections are swapped for a table where the first one stood; an
 * entry with neither gets a table straight under its line, but only when some
 * value is actually set. Notes and any other lines are left alone.
 */
export function planMachineEntryBlock(
  lines: readonly string[],
  entryLine: number,
  entryText: string,
  software: MachineSoftware
): BlockEdit | null {
  const end = machineDetailEnd(lines, entryLine)
  const expected = lines.slice(entryLine, end).map(clean)
  const detail = expected.slice(1)
  const at = (line: number): number => line - entryLine - 1
  const indent = contentIndent(expected[0])
  let nextDetail = detail

  const table = findTable(lines, entryLine, end)
  const legacy = table ? null : findLegacySections(lines, entryLine, end)
  const hasValue = SOFTWARE_SECTIONS.some((s) => SOFTWARE_KINDS.some((k) => software[s][k].trim()))
  if (table) {
    const current = softwareFromItems(table.items)
    const changed = SOFTWARE_SECTIONS.some((s) =>
      SOFTWARE_KINDS.some((k) => current[s][k] !== software[s][k].trim())
    )
    if (changed) {
      const tableIndent = ' '.repeat(indentOf(detail[at(table.start)]))
      nextDetail = [
        ...detail.slice(0, at(table.start)),
        ...softwareTableLines(software, tableIndent, table.extraRows),
        ...detail.slice(at(table.last) + 1)
      ]
    }
  } else if (legacy && legacy.lines.length && (hasValue || legacy.items.length)) {
    const drop = new Set(legacy.lines.map(at))
    const first = at(legacy.lines[0])
    nextDetail = detail.flatMap((l, i) =>
      i === first ? softwareTableLines(software, indent) : drop.has(i) ? [] : [l]
    )
  } else if (hasValue) {
    nextDetail = [...softwareTableLines(software, indent), ...detail]
  }

  const next = [entryText, ...nextDetail]
  if (next.length === expected.length && next.every((l, i) => l === expected[i])) return null
  return { from: entryLine, to: end, expected, next }
}
