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

  it('appends a bare task line when there is no body or reason', async () => {
    await addCard({ kind: 'note', path: 'Note.md' }, ' ', 'task text', '')

    expect(appendToNote).toHaveBeenCalledWith('Note.md', '- [ ] task text')
  })

  it('re-indents the composed body under the new task line', async () => {
    await addCard({ kind: 'note', path: 'Note.md' }, ' ', 'task', '- first\n- second')

    expect(appendToNote).toHaveBeenCalledWith(
      'Note.md',
      ['- [ ] task', '  - first', '  - second'].join('\n')
    )
  })

  it('puts the reason line right under the task, ahead of the body', async () => {
    await addCard(
      { kind: 'note', path: 'Note.md' },
      'w',
      'task',
      '- note',
      '  Reason for Waiting: blocked ⏳ 2026-08-18'
    )

    expect(appendToNote).toHaveBeenCalledWith(
      'Note.md',
      ['- [w] task', '  Reason for Waiting: blocked ⏳ 2026-08-18', '  - note'].join('\n')
    )
  })

  it('goes to the weekly note for a global/folder scope', async () => {
    await addCard({ kind: 'global' }, ' ', 'task', '')

    expect(appendToWeeklyNote).toHaveBeenCalledWith('- [ ] task')
    expect(appendToNote).not.toHaveBeenCalled()
  })
})
