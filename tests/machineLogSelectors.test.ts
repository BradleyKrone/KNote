import { describe, expect, it } from 'vitest'
import type { MachineDef, NoteMeta } from '@shared/types'
import { parseNote } from '@shared/parser/parseNote'
import {
  buildRegistry,
  collectMachineEntries,
  groupBySerial,
  machineFilterTags,
  machineSerials
} from '@/machineLog/machineLogSelectors'

/** Build a notes Map by parsing each [path, content] pair (mtime fixed for determinism). */
function vault(...files: Array<[string, string]>): Map<string, NoteMeta> {
  const notes = new Map<string, NoteMeta>()
  for (const [path, content] of files) notes.set(path, parseNote(path, content, 1_700_000_000_000))
  return notes
}

describe('machineLogSelectors', () => {
  it('builds the registry with last definition winning on duplicate serials', () => {
    const machines: MachineDef[] = [
      { serial: 'Z6A00101', model: 'D6', attributes: ['LGP'] },
      { serial: 'Z6A00101', model: 'D6', attributes: ['LGP', 'VP', 'EX'] }
    ]
    const registry = buildRegistry(machines)
    expect(registry.size).toBe(1)
    expect(registry.get('Z6A00101')).toMatchObject({ model: 'D6', attributes: ['LGP', 'VP', 'EX'] })
  })

  it('joins entries to their registry config', () => {
    const notes = vault(['log.md', '🚜 Z6A00101 Replaced final drive #maintenance 📅 2026-07-03\n'])
    const machines: MachineDef[] = [
      { serial: 'Z6A00101', model: 'D6', attributes: ['LGP', 'VP', 'EX'] }
    ]
    const entries = collectMachineEntries(notes, machines)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      serial: 'Z6A00101',
      date: '2026-07-03',
      text: 'Replaced final drive',
      tags: ['maintenance'],
      model: 'D6',
      attributes: ['LGP', 'VP', 'EX'],
      registered: true
    })
  })

  it('shows unregistered entries with empty config', () => {
    const notes = vault(['log.md', '🚜 UNKNOWN01 fixed something 📅 2026-07-01\n'])
    const entries = collectMachineEntries(notes, [])
    expect(entries[0]).toMatchObject({ registered: false, model: '', attributes: [] })
  })

  it('sorts entries most recent first', () => {
    const notes = vault([
      'log.md',
      '🚜 A1 old 📅 2026-06-01\n🚜 A1 new 📅 2026-07-01\n🚜 A1 mid 📅 2026-06-15\n'
    ])
    const entries = collectMachineEntries(notes, [])
    expect(entries.map((e) => e.date)).toEqual(['2026-07-01', '2026-06-15', '2026-06-01'])
  })

  it('filters by serial', () => {
    const notes = vault(['log.md', '🚜 A1 work a 📅 2026-07-01\n🚜 B2 work b 📅 2026-07-02\n'])
    const entries = collectMachineEntries(notes, [], { serial: 'A1', tags: [], text: '' })
    expect(entries).toHaveLength(1)
    expect(entries[0].serial).toBe('A1')
  })

  it('filters by config attribute as well as inline tag', () => {
    const notes = vault([
      'log.md',
      '🚜 A1 work a #service 📅 2026-07-01\n🚜 B2 work b 📅 2026-07-02\n'
    ])
    const machines: MachineDef[] = [
      { serial: 'A1', model: 'D6', attributes: ['LGP'] },
      { serial: 'B2', model: 'D8', attributes: ['XL'] }
    ]
    // config attribute
    expect(
      collectMachineEntries(notes, machines, { serial: null, tags: ['LGP'], text: '' })
    ).toHaveLength(1)
    // model
    expect(
      collectMachineEntries(notes, machines, { serial: null, tags: ['D8'], text: '' })[0].serial
    ).toBe('B2')
    // inline tag
    expect(
      collectMachineEntries(notes, machines, { serial: null, tags: ['service'], text: '' })[0]
        .serial
    ).toBe('A1')
  })

  it('filters by multiple tags at once, requiring all to match (AND)', () => {
    const notes = vault([
      'log.md',
      '🚜 A1 work a 📅 2026-07-01\n🚜 B2 work b 📅 2026-07-02\n🚜 C3 work c 📅 2026-07-03\n'
    ])
    const machines: MachineDef[] = [
      { serial: 'A1', model: 'D6', attributes: ['LGP'] },
      { serial: 'B2', model: 'D6', attributes: ['XL'] },
      { serial: 'C3', model: 'D8', attributes: ['LGP'] }
    ]
    const entries = collectMachineEntries(notes, machines, {
      serial: null,
      tags: ['D6', 'LGP'],
      text: ''
    })
    expect(entries).toHaveLength(1)
    expect(entries[0].serial).toBe('A1')
  })

  it('filters by text across activity and serial', () => {
    const notes = vault([
      'log.md',
      '🚜 A1 replaced drive 📅 2026-07-01\n🚜 B2 oil change 📅 2026-07-02\n'
    ])
    expect(
      collectMachineEntries(notes, [], { serial: null, tags: [], text: 'oil' })[0].serial
    ).toBe('B2')
    expect(collectMachineEntries(notes, [], { serial: null, tags: [], text: 'a1' })[0].serial).toBe(
      'A1'
    )
  })

  it('groups entries by serial with each group carrying its definition', () => {
    const notes = vault([
      'log.md',
      '🚜 A1 first 📅 2026-07-01\n🚜 B2 other 📅 2026-07-02\n🚜 A1 second 📅 2026-07-03\n'
    ])
    const machines: MachineDef[] = [{ serial: 'A1', model: 'D6', attributes: ['LGP'] }]
    const groups = groupBySerial(collectMachineEntries(notes, machines), buildRegistry(machines))
    expect(groups.map((g) => g.serial)).toEqual(['A1', 'B2'])
    expect(groups[0].entries).toHaveLength(2)
    expect(groups[0].def).toMatchObject({ model: 'D6' })
    expect(groups[1].def).toBeUndefined()
  })

  it('lists distinct serials and filter tags from both entries and the registry', () => {
    const notes = vault(['log.md', '🚜 A1 work #service 📅 2026-07-01\n🚜 B2 work 📅 2026-07-02\n'])
    const machines: MachineDef[] = [{ serial: 'A1', model: 'D6', attributes: ['LGP'] }]
    expect(machineSerials(notes, machines)).toEqual(['A1', 'B2'])
    expect(machineFilterTags(notes, machines)).toEqual(['D6', 'LGP', 'service'])
  })

  it('lists a registered serial with no logged entries', () => {
    const notes = vault(['log.md', '🚜 A1 work 📅 2026-07-01\n'])
    const machines: MachineDef[] = [{ serial: 'Z9', model: 'D8', attributes: [] }]
    expect(machineSerials(notes, machines)).toEqual(['A1', 'Z9'])
  })
})
