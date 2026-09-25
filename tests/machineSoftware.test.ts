import { describe, expect, it } from 'vitest'
import {
  emptySoftware,
  machineDetailEnd,
  machineDetailLines,
  owningMachineEntry,
  parseMachineDetail,
  planMachineEntryBlock,
  softwareFromItems,
  softwareTableLines,
  type BlockEdit,
  type MachineSoftware
} from '@shared/machineSoftware'

const ENTRY = [
  '🚜 Z6A00101 📅 2026-09-24 Flashed display',
  '| Software  | Base  | Flashed |',
  '| --------- | ----- | ------- |',
  '| Implement |       |         |',
  '| EC520     | 2.2.0 |         |',
  '| Machine   | 1.2.3 | 1.4.0   |',
  '| Display   | 4.0.1 | 4.1.0   |',
  '- Notes: all good'
]

const LEGACY = [
  '🚜 A1 📅 2026-09-18',
  '- Base Machine Software:',
  '  - Implement: fd',
  '  - Display: 4.0',
  '- Software Flashed:',
  '  - Display: 4.1',
  '- Notes: keep me'
]

function software(
  base: Partial<MachineSoftware['base']> = {},
  flashed: Partial<MachineSoftware['flashed']> = {}
): MachineSoftware {
  const sw = emptySoftware()
  Object.assign(sw.base, base)
  Object.assign(sw.flashed, flashed)
  return sw
}

/** Apply a planned block edit to a copy of `lines`. */
function apply(lines: string[], plan: BlockEdit | null): string[] {
  if (!plan) return lines
  expect(lines.slice(plan.from, plan.to)).toEqual(plan.expected)
  return [...lines.slice(0, plan.from), ...plan.next, ...lines.slice(plan.to)]
}

describe('parseMachineDetail', () => {
  it('reads the software table, both columns', () => {
    expect(softwareFromItems(parseMachineDetail(ENTRY, 0))).toEqual(
      software(
        { EC520: '2.2.0', Machine: '1.2.3', Display: '4.0.1' },
        { Machine: '1.4.0', Display: '4.1.0' }
      )
    )
    expect(parseMachineDetail(ENTRY, 0).find((i) => i.kind === 'Display')).toMatchObject({
      line: 6,
      rawLine: '| Display   | 4.0.1 | 4.1.0   |'
    })
  })

  it('tolerates any case, CRLF, unpadded cells and escaped pipes', () => {
    const piped = [
      '🚜 A1',
      '| software | BASE | flashed |\r',
      '|---|---|---|\r',
      '| display | 1.0 \\| beta | 2.0 |\r'
    ]
    expect(softwareFromItems(parseMachineDetail(piped, 0))).toEqual(
      software({ Display: '1.0 | beta' }, { Display: '2.0' })
    )
  })

  it('still reads the legacy list sections', () => {
    expect(softwareFromItems(parseMachineDetail(LEGACY, 0))).toEqual(
      software({ Implement: 'fd', Display: '4.0' }, { Display: '4.1' })
    )
  })

  it('returns nothing for the original free-text template', () => {
    const lines = ['🚜 A1', '- Base Machine Software: 1.2', '- Testing Software: ', '- Notes: ']
    expect(parseMachineDetail(lines, 0)).toEqual([])
  })
})

describe('machineDetailEnd', () => {
  it('owns table rows and list items, stopping at a blank line, heading or next entry', () => {
    expect(machineDetailEnd([...ENTRY, '', '- after'], 0)).toBe(ENTRY.length)
    expect(machineDetailEnd(['🚜 A1', '- Notes: x', '## Next'], 0)).toBe(2)
    expect(machineDetailEnd(['🚜 A1', '| Software | Base | Flashed |', '🚜 A2'], 0)).toBe(2)
  })

  it('stops at plain prose and at a checkbox at the entry depth', () => {
    expect(machineDetailEnd(['🚜 A1', '- Notes: x', 'Some prose'], 0)).toBe(2)
    expect(machineDetailEnd(['🚜 A1', '- Notes: x', '- [ ] @task next'], 0)).toBe(2)
  })
})

describe('owningMachineEntry', () => {
  it('finds the entry from any line of its block, table cells included', () => {
    expect(owningMachineEntry(ENTRY, 0)).toBe(0)
    expect(owningMachineEntry(ENTRY, 5)).toBe(0)
    expect(owningMachineEntry(ENTRY, 7)).toBe(0)
  })

  it('returns null past the block or with no entry above', () => {
    expect(owningMachineEntry([...ENTRY, '', 'prose'], 9)).toBeNull()
    expect(owningMachineEntry(['| Display | 1 | 2 |'], 0)).toBeNull()
  })
})

describe('softwareTableLines / machineDetailLines', () => {
  it('pads columns so the table lines up in plain text', () => {
    expect(softwareTableLines(software({ EC520: '2.2.0' }, { Display: '4.1.0' }))).toEqual([
      '| Software  | Base  | Flashed |',
      '| --------- | ----- | ------- |',
      '| Implement |       |         |',
      '| EC520     | 2.2.0 |         |',
      '| Machine   |       |         |',
      '| Display   |       | 4.1.0   |'
    ])
  })

  it('round-trips through the parser, pipes escaped', () => {
    const sw = software({ EC520: 'a|b' }, { Display: '4.1.0' })
    const lines = ['🚜 A1', ...machineDetailLines(sw)]
    expect(softwareFromItems(parseMachineDetail(lines, 0))).toEqual(sw)
    expect(lines.at(-1)).toBe('- Notes: ')
  })
})

describe('planMachineEntryBlock', () => {
  const current = softwareFromItems(parseMachineDetail(ENTRY, 0))

  it('plans nothing when nothing changed', () => {
    expect(planMachineEntryBlock(ENTRY, 0, ENTRY[0], current)).toBeNull()
  })

  it('rewrites just the entry line when only it changed', () => {
    const out = apply(ENTRY, planMachineEntryBlock(ENTRY, 0, '🚜 Z6A00102', current))
    expect(out).toEqual(['🚜 Z6A00102', ...ENTRY.slice(1)])
  })

  it('rewrites the table, re-padded, keeping Notes', () => {
    const next = software(
      { ...current.base, Display: '' },
      { ...current.flashed, Display: '4.10.0-rc1' }
    )
    const out = apply(ENTRY, planMachineEntryBlock(ENTRY, 0, ENTRY[0], next))
    expect(out).toEqual([
      ENTRY[0],
      '| Software  | Base  | Flashed    |',
      '| --------- | ----- | ---------- |',
      '| Implement |       |            |',
      '| EC520     | 2.2.0 |            |',
      '| Machine   | 1.2.3 | 1.4.0      |',
      '| Display   |       | 4.10.0-rc1 |',
      '- Notes: all good'
    ])
  })

  it('keeps extra rows the user added to the table', () => {
    const lines = [...ENTRY.slice(0, 7), '| Receiver  | 1     | 2       |']
    const out = apply(
      lines,
      planMachineEntryBlock(lines, 0, lines[0], software({}, { EC520: '3' }))
    )
    expect(out.at(-1)).toBe('| Receiver  | 1    | 2       |')
  })

  it('swaps legacy list sections for a table where they stood', () => {
    const sw = softwareFromItems(parseMachineDetail(LEGACY, 0))
    const out = apply(LEGACY, planMachineEntryBlock(LEGACY, 0, LEGACY[0], sw))
    expect(out).toEqual([
      LEGACY[0],
      '| Software  | Base | Flashed |',
      '| --------- | ---- | ------- |',
      '| Implement | fd   |         |',
      '| EC520     |      |         |',
      '| Machine   |      |         |',
      '| Display   | 4.0  | 4.1     |',
      '- Notes: keep me'
    ])
  })

  it('adds a table straight under an entry that has none, only when a value is set', () => {
    const lines = ['🚜 A1', '- Testing Software: old', '- Notes: x']
    expect(planMachineEntryBlock(lines, 0, lines[0], emptySoftware())).toBeNull()
    const out = apply(
      lines,
      planMachineEntryBlock(lines, 0, lines[0], software({}, { Machine: '2' }))
    )
    expect(out.slice(0, 2)).toEqual(['🚜 A1', '| Software  | Base | Flashed |'])
    expect(out.slice(-2)).toEqual(['- Testing Software: old', '- Notes: x'])
  })

  it('indents the table under a bulleted entry so it stays in the list item', () => {
    const lines = ['  - 🚜 A1']
    const out = apply(lines, planMachineEntryBlock(lines, 0, lines[0], software({ EC520: '1' })))
    expect(out[1]).toBe('    | Software  | Base | Flashed |')
    expect(softwareFromItems(parseMachineDetail(out, 0)).base.EC520).toBe('1')
  })
})
