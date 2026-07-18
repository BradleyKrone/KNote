import { describe, expect, it } from 'vitest'
import { diffEdit } from '@shared/editorSync'

/** Apply a CmEdit to a string, the way CodeMirror applies the dispatched change. */
function apply(current: string, edit: ReturnType<typeof diffEdit>): string {
  return current.slice(0, edit.from) + edit.insert + current.slice(edit.to)
}

describe('diffEdit', () => {
  it('returns a no-op edit for identical text', () => {
    const edit = diffEdit('abc', 'abc')
    expect(edit.from).toBe(edit.to)
    expect(edit.insert).toBe('')
    expect(apply('abc', edit)).toBe('abc')
  })

  it('localizes a single mid-document change to the changed span', () => {
    const before = 'line one\nline two\nline three'
    const after = 'line one\nline TWO\nline three'
    const edit = diffEdit(before, after)
    // Only the differing region is touched — the prefix before it is untouched,
    // which is what keeps CodeMirror's scroll anchor fixed.
    expect(before.slice(0, edit.from)).toBe('line one\nline ')
    expect(edit).toEqual({ from: 14, to: 17, insert: 'TWO' })
    expect(apply(before, edit)).toBe(after)
  })

  it('handles a sub-task toggle (append ✅ date to a line) without touching earlier lines', () => {
    const before = '- [ ] parent\n  - [ ] sub\nmore notes below'
    const after = '- [ ] parent\n  - [x] sub ✅ 2026-07-17\nmore notes below'
    const edit = diffEdit(before, after)
    // The change starts on the sub-task line — the parent line above is fixed.
    expect(edit.from).toBeGreaterThan(before.indexOf('parent'))
    expect(before.slice(0, edit.from).startsWith('- [ ] parent\n')).toBe(true)
    expect(apply(before, edit)).toBe(after)
  })

  it('trims a common suffix (pure insertion in the middle)', () => {
    const before = 'headtail'
    const after = 'headINSERTtail'
    expect(diffEdit(before, after)).toEqual({ from: 4, to: 4, insert: 'INSERT' })
  })

  it('handles a pure deletion', () => {
    const before = 'headREMOVEtail'
    const after = 'headtail'
    const edit = diffEdit(before, after)
    expect(edit).toEqual({ from: 4, to: 10, insert: '' })
    expect(apply(before, edit)).toBe(after)
  })

  it('replaces the whole string when nothing is common', () => {
    expect(diffEdit('abc', 'xyz')).toEqual({ from: 0, to: 3, insert: 'xyz' })
  })
})
