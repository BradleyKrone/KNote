import { describe, expect, it } from 'vitest'
import { emptySoftware, machineEntryTemplate } from '@shared/machineSoftware'
import { planMachineEntryEdit, readMachineEntryCtx } from '@/shared/machineEntryEdit'
import {
  buildMachineEntryLine,
  editMachineLine,
  lineDue,
  normalizePastedText
} from '@/editor/editorActions'

describe('normalizePastedText', () => {
  it('rewrites CRLF and lone CR to the document’s own line ending', () => {
    expect(normalizePastedText('a\r\nb\rc', '\n')).toBe('a\nb\nc')
    expect(normalizePastedText('a\nb', '\r\n')).toBe('a\nb')
    expect(normalizePastedText('a\r\nb', '\r\n')).toBe('a\r\nb')
  })
  it('leaves text without line breaks alone', () => {
    expect(normalizePastedText('plain text', '\n')).toBe('plain text')
    expect(normalizePastedText('', '\n')).toBe('')
  })
})

describe('buildMachineEntryLine', () => {
  it('builds a dated 🚜 entry line', () => {
    expect(buildMachineEntryLine('Z6A00101', '2026-07-16', [])).toBe('🚜 Z6A00101 📅 2026-07-16')
  })
  it('inserts registered tags before the date', () => {
    expect(buildMachineEntryLine('Z6A00101', '2026-07-16', ['D6', 'LGP'])).toBe(
      '🚜 Z6A00101 #D6 #LGP 📅 2026-07-16'
    )
  })
})

describe('editMachineLine', () => {
  it('rewrites the serial and date, keeping inline tags/activity text', () => {
    const before = '🚜 OLD swapped the pump #D6 📅 2026-07-01'
    expect(editMachineLine(before, 'NEW', '2026-07-16')).toBe(
      '🚜 NEW swapped the pump #D6 📅 2026-07-16'
    )
  })
  it('adds a date when the entry had none', () => {
    expect(editMachineLine('🚜 Z6 replaced belt', 'Z6', '2026-07-16')).toBe(
      '🚜 Z6 replaced belt 📅 2026-07-16'
    )
  })
  it('clears the date when null', () => {
    expect(editMachineLine('🚜 Z6 note 📅 2026-07-01', 'Z6', null)).toBe('🚜 Z6 note')
  })
  it('drops to just the serial when there is no activity text', () => {
    expect(editMachineLine('🚜 Z6 📅 2026-07-01', 'Z6', null)).toBe('🚜 Z6')
  })
  it('leaves a non-machine line untouched', () => {
    expect(editMachineLine('- [ ] @task not a machine', 'Z6', '2026-07-16')).toBe(
      '- [ ] @task not a machine'
    )
  })
  it('preserves a bullet prefix when rewriting', () => {
    const before = '- 🚜 OLD swapped the pump #D6 📅 2026-07-01'
    expect(editMachineLine(before, 'NEW', '2026-07-16')).toBe(
      '- 🚜 NEW swapped the pump #D6 📅 2026-07-16'
    )
  })
  it('preserves a label prefix when rewriting', () => {
    expect(editMachineLine('Log: 🚜 Z6 note 📅 2026-07-01', 'Z6', null)).toBe('Log: 🚜 Z6 note')
  })
})

describe('lineDue', () => {
  it('reads a 📅 date', () => {
    expect(lineDue('🏁 Ship it 📅 2026-07-16')).toBe('2026-07-16')
  })
  it('reads an @due(...) date', () => {
    expect(lineDue('- [ ] @task task @due(2026-07-16)')).toBe('2026-07-16')
  })
  it('returns null when there is no date', () => {
    expect(lineDue('- [ ] @task no date here')).toBeNull()
  })
})

describe('machine entry popup', () => {
  const doc = [
    'Intro',
    '',
    '- 🚜 Z6A00101 #D6 📅 2026-09-24 Flashed display',
    '  | Software  | Base  | Flashed |',
    '  | --------- | ----- | ------- |',
    '  | Implement |       |         |',
    '  | EC520     |       |         |',
    '  | Machine   |       |         |',
    '  | Display   | 4.0.1 | 4.1.0   |',
    '  - Notes: ok',
    '',
    'After'
  ]

  it('reads the owning entry from the 🚜 line or any line of its block', () => {
    for (const line of [2, 8, 9]) {
      const ctx = readMachineEntryCtx(doc, line)
      expect(ctx).toMatchObject({ line0: 2, serial: 'Z6A00101', due: '2026-09-24' })
      expect(ctx?.software.base.Display).toBe('4.0.1')
      expect(ctx?.software.flashed.Display).toBe('4.1.0')
    }
    expect(readMachineEntryCtx(doc, 0)).toBeNull()
    expect(readMachineEntryCtx(doc, 11)).toBeNull()
  })

  it('saves serial, date and software back as one block edit', () => {
    const sw = readMachineEntryCtx(doc, 2)!.software
    sw.flashed.Display = '4.2.0'
    sw.flashed.EC520 = '2.3'
    const plan = planMachineEntryEdit(doc, 2, 'Z6A00102', '2026-09-25', sw)
    expect(plan).toMatchObject({ from: 2, to: 10, expected: doc.slice(2, 10) })
    expect(plan?.next).toEqual([
      '- 🚜 Z6A00102 #D6 Flashed display 📅 2026-09-25',
      '  | Software  | Base  | Flashed |',
      '  | --------- | ----- | ------- |',
      '  | Implement |       |         |',
      '  | EC520     |       | 2.3     |',
      '  | Machine   |       |         |',
      '  | Display   | 4.0.1 | 4.2.0   |',
      '  - Notes: ok'
    ])
  })

  it('plans nothing when the popup is saved unchanged', () => {
    const ctx = readMachineEntryCtx(doc, 2)!
    expect(planMachineEntryEdit(doc, 2, ctx.serial, ctx.due, ctx.software)).toBeNull()
  })

  it('pre-fills the inserted template from the popup', () => {
    const sw = emptySoftware()
    sw.base.Machine = '1.2.3'
    sw.flashed.Machine = '1.4.0'
    const template = machineEntryTemplate(sw)
    expect(template.split('\n')).toEqual([
      '',
      '| Software  | Base  | Flashed |',
      '| --------- | ----- | ------- |',
      '| Implement |       |         |',
      '| EC520     |       |         |',
      '| Machine   | 1.2.3 | 1.4.0   |',
      '| Display   |       |         |',
      '- Notes: '
    ])
  })
})
