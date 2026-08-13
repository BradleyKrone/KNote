import { beforeEach, describe, expect, it, vi } from 'vitest'

const appendToNote = vi.fn().mockResolvedValue(undefined)
const appendToWeeklyNote = vi.fn().mockResolvedValue('Weekly.md')

vi.mock('@/shared/rpc', () => ({
  host: {
    appendToNote: (...args: unknown[]) => appendToNote(...args),
    appendToWeeklyNote: (...args: unknown[]) => appendToWeeklyNote(...args)
  }
}))
vi.mock('@/shared/stores', () => ({
  showToast: vi.fn(),
  useConfigStore: { getState: () => ({ load: vi.fn(), vaultConfig: {} }) },
  useIndexStore: { getState: () => ({ notes: new Map() }) }
}))

const { addCard } = await import('@/board/boardActions')

describe('addCard', () => {
  beforeEach(() => {
    appendToNote.mockClear()
    appendToWeeklyNote.mockClear()
  })

  it('stamps Status Changed / Date Entered even with no body or reason', async () => {
    await addCard({ kind: 'note', path: 'Note.md' }, ' ', 'task text', '')

    const [, line] = appendToNote.mock.calls[0] as [string, string]
    const rows = line.split('\n')
    expect(rows[0]).toBe('- [ ] task text')
    expect(rows[1]).toBe('  - Status Changed: n/a')
    expect(rows[2]).toMatch(/^ {2}- Date Entered: \d{1,2}\/\d{1,2}\/\d{4}$/)
    expect(rows).toHaveLength(3)
  })

  it('re-indents the composed body under the stamped meta lines', async () => {
    await addCard({ kind: 'note', path: 'Note.md' }, ' ', 'task', '- first\n- second')

    const [, line] = appendToNote.mock.calls[0] as [string, string]
    const rows = line.split('\n')
    expect(rows.slice(0, 1)).toEqual(['- [ ] task'])
    expect(rows.slice(3)).toEqual(['  - first', '  - second'])
  })

  it('puts the reason line right under the task, ahead of the stamp and body', async () => {
    await addCard(
      { kind: 'note', path: 'Note.md' },
      'w',
      'task',
      '- note',
      '  Reason for Waiting: blocked ⏳ 2026-08-18'
    )

    const [, line] = appendToNote.mock.calls[0] as [string, string]
    const rows = line.split('\n')
    expect(rows[0]).toBe('- [w] task')
    expect(rows[1]).toBe('  Reason for Waiting: blocked ⏳ 2026-08-18')
    expect(rows[2]).toBe('  - Status Changed: n/a')
    expect(rows[4]).toBe('  - note')
  })

  it('goes to the weekly note for a global/folder scope', async () => {
    await addCard({ kind: 'global' }, ' ', 'task', '')

    expect(appendToWeeklyNote).toHaveBeenCalled()
    const [line] = appendToWeeklyNote.mock.calls[0] as [string]
    expect(line.split('\n')[0]).toBe('- [ ] task')
    expect(appendToNote).not.toHaveBeenCalled()
  })
})
