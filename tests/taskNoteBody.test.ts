import { describe, expect, it } from 'vitest'
import {
  blockBaseIndent,
  noteBodyFromText,
  noteBodyIndent,
  noteBodyToText,
  taskChildIndent
} from '@shared/parser/taskNoteBody'

describe('blockBaseIndent', () => {
  it('uses the fallback only when there is no block yet', () => {
    expect(blockBaseIndent([], '  ')).toBe('  ')
    expect(blockBaseIndent(['    - deep'], '  ')).toBe('    ')
  })

  it('returns no indent for a block whose lines share none, ignoring the fallback', () => {
    // The fallback here would re-indent the whole block on every save;
    // `noteBodyToText` hands these lines back verbatim, so this must too.
    expect(blockBaseIndent(['- flush', '  - deeper'], '  ')).toBe('')
  })

  it('is the exact inverse of noteBodyToText', () => {
    for (const block of [
      ['  - Notes: a', '  - b'],
      ['\t- tabbed', '\t\t- deeper'],
      ['- flush', '  - deeper'],
      ['  - a', '', '  - b'],
      ['  - Notes: x', '  - [ ] child', '    - Status Changed: 7/2/2026']
    ]) {
      const text = noteBodyToText(block)
      expect(noteBodyFromText(text, blockBaseIndent(block, '  '))).toEqual(block)
    }
  })
})

describe('taskChildIndent', () => {
  it('is the task’s own indent plus two, matching what the seeders write', () => {
    expect(taskChildIndent('- [ ] top level')).toBe('  ')
    expect(taskChildIndent('  - [x] nested')).toBe('    ')
    expect(taskChildIndent('\t- [/] tabbed')).toBe('\t  ')
  })

  it('falls back to two spaces for a line that is not a task', () => {
    expect(taskChildIndent('not a task')).toBe('  ')
  })
})

describe('noteBodyIndent', () => {
  it('finds the common indent of a plain block', () => {
    expect(noteBodyIndent(['  - Notes: a', '  - b'], '§')).toBe('  ')
  })

  it('keeps tabs rather than normalising them to spaces', () => {
    expect(noteBodyIndent(['\t- Notes: a', '\t- b'], '  ')).toBe('\t')
  })

  it('takes the shallowest line, so deeper lines keep a relative indent', () => {
    expect(noteBodyIndent(['  - Notes: a', '    - deeper'], '§')).toBe('  ')
  })

  it('ignores blank lines when computing the common prefix', () => {
    expect(noteBodyIndent(['  - a', '', '  - b'], '§')).toBe('  ')
  })

  it('falls back for an empty block', () => {
    expect(noteBodyIndent([], '  ')).toBe('  ')
  })

  it('falls back when tabs and spaces share no prefix', () => {
    expect(noteBodyIndent(['\t- a', '  - b'], '  ')).toBe('  ')
  })
})

describe('noteBodyToText / noteBodyFromText', () => {
  it('strips the common indent for display and puts it back on save', () => {
    const body = ['  - Notes: first', '  - second']
    const text = noteBodyToText(body)
    expect(text).toBe('- Notes: first\n- second')
    expect(noteBodyFromText(text, noteBodyIndent(body, '  '))).toEqual(body)
  })

  it('round-trips a tab-indented block as tabs', () => {
    const body = ['\t- Notes: a', '\t- b']
    expect(noteBodyFromText(noteBodyToText(body), noteBodyIndent(body, '  '))).toEqual(body)
  })

  it('preserves the relative indent of a deeper sub-bullet', () => {
    const body = ['  - Notes: parent', '    - child', '      - grandchild']
    expect(noteBodyToText(body)).toBe('- Notes: parent\n  - child\n    - grandchild')
    expect(noteBodyFromText(noteBodyToText(body), noteBodyIndent(body, '  '))).toEqual(body)
  })

  it('round-trips blank lines inside the body as genuinely empty lines', () => {
    const body = ['  - Notes: one', '', '  two']
    expect(noteBodyToText(body)).toBe('- Notes: one\n\ntwo')
    expect(noteBodyFromText(noteBodyToText(body), '  ')).toEqual(body)
  })

  it('never leaves trailing whitespace on a blank line', () => {
    expect(noteBodyFromText('a\n   \nb', '  ')).toEqual(['  a', '', '  b'])
  })

  it('strips \\r out of a CRLF paste, so the write path cannot double the EOL', () => {
    expect(noteBodyFromText('one\r\ntwo\rthree', '  ')).toEqual(['  one', '  two', '  three'])
  })

  it('drops leading and trailing blank lines, keeping the write idempotent', () => {
    expect(noteBodyFromText('\n\n- a\n\n\n', '  ')).toEqual(['  - a'])
  })

  it('maps empty text to an empty block', () => {
    expect(noteBodyFromText('', '  ')).toEqual([])
    expect(noteBodyFromText('   \n  ', '  ')).toEqual([])
  })

  it('shows an empty block as empty text', () => {
    expect(noteBodyToText([])).toBe('')
  })
})
