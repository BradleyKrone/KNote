import { describe, expect, it } from 'vitest'
import { buildMachineEntryLine, editMachineLine, lineDue } from '@/editor/editorActions'

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
    expect(editMachineLine('- [ ] not a machine', 'Z6', '2026-07-16')).toBe('- [ ] not a machine')
  })
})

describe('lineDue', () => {
  it('reads a 📅 date', () => {
    expect(lineDue('🏁 Ship it 📅 2026-07-16')).toBe('2026-07-16')
  })
  it('reads an @due(...) date', () => {
    expect(lineDue('- [ ] task @due(2026-07-16)')).toBe('2026-07-16')
  })
  it('returns null when there is no date', () => {
    expect(lineDue('- [ ] no date here')).toBeNull()
  })
})
