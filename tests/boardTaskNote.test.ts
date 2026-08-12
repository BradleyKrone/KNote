import { beforeEach, describe, expect, it, vi } from 'vitest'

const setTaskTextAndNotes = vi.fn().mockResolvedValue(undefined)
const showToast = vi.fn()

vi.mock('@/shared/rpc', () => ({
  host: { setTaskTextAndNotes: (...args: unknown[]) => setTaskTextAndNotes(...args) }
}))
vi.mock('@/shared/stores', () => ({
  showToast: (...args: unknown[]) => showToast(...args),
  useConfigStore: { getState: () => ({ load: vi.fn(), vaultConfig: {} }) },
  useIndexStore: { getState: () => ({ notes: new Map() }) }
}))

const { updateCardNote } = await import('@/board/boardActions')
const { toCard } = await import('@/board/boardSelectors')
const { parseNote } = await import('@shared/parser/parseNote')

import type { BoardCard } from '@/board/boardSelectors'

/** The card for the first task of a one-note vault built from `content`. */
function card(content: string): BoardCard {
  const meta = parseNote('Note.md', content)
  return toCard(meta, meta.tasks[0])
}

const seeded =
  '- [ ] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/1/2026\n  - Notes: original\n'

describe('updateCardNote', () => {
  beforeEach(() => {
    setTaskTextAndNotes.mockClear()
    showToast.mockClear()
  })

  it('re-indents the edited text to the block’s existing indent', async () => {
    const c = card(seeded)
    await updateCardNote(c, 'task', '- Notes: rewritten\n- second')

    expect(setTaskTextAndNotes).toHaveBeenCalledWith(
      'Note.md',
      0,
      '- [ ] task',
      '- [ ] task',
      ['  - Notes: rewritten', '  - second'],
      // The block the dialog was showing, so the host can refuse a save whose
      // subtree moved underneath it.
      ['  - Notes: original']
    )
  })

  it('edits sub-tasks along with the notes, and sends them back as one block', async () => {
    const c = card(
      '- [ ] task\n  - Status Changed: 7/14/2026\n  - Notes: mine\n  - [ ] child\n    - Status Changed: 7/2/2026\n'
    )
    // What the dialog shows: the whole subtree, dedented — its own managed line
    // excluded, the child's kept.
    expect(c.blockLines).toEqual([
      '  - Notes: mine',
      '  - [ ] child',
      '    - Status Changed: 7/2/2026'
    ])

    await updateCardNote(c, 'task', '- Notes: mine\n- [x] child\n  - Status Changed: 7/2/2026')
    expect(setTaskTextAndNotes.mock.calls[0][4]).toEqual([
      '  - Notes: mine',
      '  - [x] child',
      '    - Status Changed: 7/2/2026'
    ])
  })

  it('does not re-indent a block whose lines share no common indent', async () => {
    // A same-indent list item under the task leaves the block's common indent
    // empty; `noteBodyToText` hands those lines back verbatim, so the way in
    // must not fall back to the task's indent or the block gains two spaces on
    // every save. Round-tripping the text unchanged has to write it unchanged.
    const c = card('- [ ] task\n- flush note\n  - deeper\n')
    expect(c.blockLines).toEqual(['- flush note', '  - deeper'])

    await updateCardNote(c, 'task!', '- flush note\n  - deeper')
    expect(setTaskTextAndNotes.mock.calls[0][4]).toEqual(['- flush note', '  - deeper'])
  })

  it('keeps a tab-indented block on tabs', async () => {
    const c = card('- [ ] task\n\t- Notes: original\n')
    await updateCardNote(c, 'task', '- Notes: new')

    expect(setTaskTextAndNotes.mock.calls[0][4]).toEqual(['\t- Notes: new'])
  })

  it('falls back to the task’s indent + 2 for a task getting its first note', async () => {
    const c = card('- [ ] bare\n')
    await updateCardNote(c, 'bare', '- Notes: brand new')

    expect(setTaskTextAndNotes.mock.calls[0][4]).toEqual(['  - Notes: brand new'])
  })

  it('rewrites the task line while preserving its ^anchor', async () => {
    const c = card('- [ ] task ^abc123\n  - Notes: n\n')
    await updateCardNote(c, 'renamed #tag', '- Notes: n')

    expect(setTaskTextAndNotes.mock.calls[0][3]).toBe('- [ ] renamed #tag ^abc123')
  })

  it('sends the unchanged raw line when only the notes changed', async () => {
    const c = card(seeded)
    await updateCardNote(c, 'task', '- Notes: only the notes moved')

    expect(setTaskTextAndNotes.mock.calls[0][3]).toBe('- [ ] task')
  })

  it('clears the body to an empty array when the editor is emptied', async () => {
    const c = card(seeded)
    await updateCardNote(c, 'task', '')

    expect(setTaskTextAndNotes.mock.calls[0][4]).toEqual([])
  })

  it('writes nothing at all when neither the text nor the notes changed', async () => {
    const c = card(seeded)
    await expect(updateCardNote(c, 'task', '- Notes: original')).resolves.toBe(true)
    expect(setTaskTextAndNotes).not.toHaveBeenCalled()
  })

  it('reports a stale refusal instead of throwing, so the dialog can stay open', async () => {
    setTaskTextAndNotes.mockRejectedValueOnce(new Error('KNOTE_STALE: line changed'))
    const c = card(seeded)

    await expect(updateCardNote(c, 'task', '- Notes: rewritten')).resolves.toBe(false)
    expect(showToast).toHaveBeenCalledWith('Note changed on disk — nothing was saved')
  })

  it('rethrows anything that is not a stale refusal', async () => {
    setTaskTextAndNotes.mockRejectedValueOnce(new Error('disk on fire'))
    const c = card(seeded)

    await expect(updateCardNote(c, 'task', '- Notes: rewritten')).rejects.toThrow('disk on fire')
  })
})
