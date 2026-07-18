import { describe, expect, it } from 'vitest'
import { setTaskDone } from '@shared/parser/patterns'

/**
 * `setTaskDone` is the pure half of clicking a sub-task checkbox: it flips the
 * `[ ]`/`[x]` bracket and keeps a trailing `✅ <date>` completion marker in
 * sync. The editor calls it, then writes the result through a verified
 * `replaceLine`.
 */
describe('setTaskDone', () => {
  it('stamps the completion date when checking', () => {
    expect(setTaskDone('  - [ ] buy milk', true, '2026-07-16')).toBe(
      '  - [x] buy milk ✅ 2026-07-16'
    )
  })

  it('removes the completion date when unchecking', () => {
    expect(setTaskDone('  - [x] buy milk ✅ 2026-07-16', false, '2026-07-17')).toBe(
      '  - [ ] buy milk'
    )
  })

  it('refreshes rather than duplicates an existing marker when re-checked', () => {
    expect(setTaskDone('  - [x] buy milk ✅ 2026-07-16', true, '2026-07-20')).toBe(
      '  - [x] buy milk ✅ 2026-07-20'
    )
  })

  it('handles a bare checkbox with no text', () => {
    expect(setTaskDone('    - [ ]', true, '2026-07-16')).toBe('    - [x] ✅ 2026-07-16')
    expect(setTaskDone('    - [x] ✅ 2026-07-16', false, '2026-07-16')).toBe('    - [ ]')
  })

  it('preserves the bullet style and indent', () => {
    expect(setTaskDone('\t* [ ] task', true, '2026-07-16')).toBe('\t* [x] task ✅ 2026-07-16')
    expect(setTaskDone('  1. [ ] task', true, '2026-07-16')).toBe('  1. [x] task ✅ 2026-07-16')
  })

  it('keeps trailing prose intact around the marker on uncheck', () => {
    expect(setTaskDone('  - [x] ship #now ✅ 2026-07-16', false, '2026-07-18')).toBe(
      '  - [ ] ship #now'
    )
  })

  it('returns null for a non-task line', () => {
    expect(setTaskDone('just a paragraph', true, '2026-07-16')).toBeNull()
  })
})
