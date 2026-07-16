import { describe, expect, it } from 'vitest'
import { checkboxRange, columnForChar, nextColumn } from '@/editor/constructLogic'
import { isEditorSyncMessage } from '@shared/editorSync'
import { DEFAULT_VAULT_CONFIG, type BoardColumn } from '@shared/types'

const COLUMNS = DEFAULT_VAULT_CONFIG.columns // [' ', 'r', 'w', '/', 'x']

describe('columnForChar', () => {
  it('maps a status char to its column, normalizing X→x', () => {
    expect(columnForChar(COLUMNS, ' ')).toBe(0)
    expect(columnForChar(COLUMNS, '/')).toBe(3)
    expect(columnForChar(COLUMNS, 'x')).toBe(4)
    expect(columnForChar(COLUMNS, 'X')).toBe(4)
  })
  it('drops unknown chars into column 0', () => {
    expect(columnForChar(COLUMNS, '?')).toBe(0)
  })
})

describe('nextColumn', () => {
  it('advances to the following column and wraps past the last', () => {
    expect(nextColumn(COLUMNS, ' ')?.char).toBe('r')
    expect(nextColumn(COLUMNS, '/')?.char).toBe('x')
    expect(nextColumn(COLUMNS, 'x')?.char).toBe(' ') // wrap
  })
  it('returns null when there are no columns', () => {
    expect(nextColumn([], ' ')).toBeNull()
  })
  it('lands on a requireReason column when appropriate', () => {
    const waiting = nextColumn(COLUMNS, 'r') as BoardColumn
    expect(waiting.char).toBe('w')
    expect(waiting.requireReason).toBe(true)
  })
})

describe('checkboxRange', () => {
  it('locates the [c] bracket and status char for a plain task', () => {
    // "- [ ] hi" → bracket at offsets 2..5
    expect(checkboxRange('- [ ] hi')).toEqual({ from: 2, to: 5, statusChar: ' ' })
  })
  it('accounts for indentation and different bullets', () => {
    expect(checkboxRange('    * [x] done')).toEqual({ from: 6, to: 9, statusChar: 'x' })
    expect(checkboxRange('1. [/] numbered')).toEqual({ from: 3, to: 6, statusChar: '/' })
  })
  it('returns null for non-task lines', () => {
    expect(checkboxRange('just text')).toBeNull()
    expect(checkboxRange('- a bullet, no checkbox')).toBeNull()
  })
})

describe('isEditorSyncMessage', () => {
  it('accepts the editor sync messages', () => {
    expect(isEditorSyncMessage({ type: 'knote:cm-edits', edits: [] })).toBe(true)
    expect(isEditorSyncMessage({ type: 'knote:host-update', text: 'x' })).toBe(true)
  })
  it('rejects RPC responses/events and junk (so the channels never cross)', () => {
    expect(isEditorSyncMessage({ id: 1, ok: true, result: null })).toBe(false)
    expect(isEditorSyncMessage({ event: 'indexDelta', payload: {} })).toBe(false)
    expect(isEditorSyncMessage(null)).toBe(false)
    expect(isEditorSyncMessage({ type: 'other' })).toBe(false)
  })
})
