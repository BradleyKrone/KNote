import { describe, expect, it } from 'vitest'
import { legacyTaskLines } from '@shared/parser/legacyTasks'
import { setTaskMarker } from '@shared/parser/patterns'

/** Apply the conversion the migration command would, so idempotence is testable here. */
function migrate(content: string): string {
  const lines = content.split(/\r?\n/)
  for (const n of legacyTaskLines(content)) {
    const next = setTaskMarker(lines[n], true)
    if (next !== null) lines[n] = next
  }
  return lines.join(content.includes('\r\n') ? '\r\n' : '\n')
}

describe('legacyTaskLines', () => {
  it('picks the checkboxes the old indent rule made cards', () => {
    const content = [
      '- [ ] task A',
      '  - [ ] subtask A1',
      '  - [ ] subtask A2',
      '- [x] task B',
      '  - [ ] subtask B1'
    ].join('\n')
    expect(legacyTaskLines(content)).toEqual([0, 3])
  })

  it('resets the stack after a dedent', () => {
    const content = ['- [ ] a', '  - [ ] a1', '- [ ] b', '    - [ ] b1', '- [ ] c'].join('\n')
    expect(legacyTaskLines(content)).toEqual([0, 2, 4])
  })

  it('treats a checkbox with no shallower checkbox above it as a card, however indented', () => {
    // The old rule was relative, not absolute: an indented checkbox under a
    // plain bullet had no checkbox ancestor, so it was a card.
    const content = ['- notes', '  - [ ] indented but a card', '    - [ ] its subtask'].join('\n')
    expect(legacyTaskLines(content)).toEqual([1])
  })

  it('never touches a checkbox inside a fenced code sample', () => {
    const content = ['- [ ] real', '', '```sh', '- [ ] fake', '```', '', '- [ ] also real'].join(
      '\n'
    )
    expect(legacyTaskLines(content)).toEqual([0, 6])
  })

  it('skips a line that already carries the marker, but keeps it as an ancestor', () => {
    const content = ['- [ ] @task already', '  - [ ] its subtask', '- [ ] not yet'].join('\n')
    expect(legacyTaskLines(content)).toEqual([2])
  })

  it('finds nothing in a fully converted note', () => {
    const content = ['- [ ] @task a', '  - [ ] child', '- [ ] @task b'].join('\n')
    expect(legacyTaskLines(content)).toEqual([])
  })

  it('ignores frontmatter and non-checkbox lines', () => {
    const content = ['---', 'type: project', '---', '', '# Plan', '', '- [ ] ship'].join('\n')
    expect(legacyTaskLines(content)).toEqual([6])
  })
})

describe('the conversion as a whole', () => {
  it('marks the cards and leaves the sub-checkboxes alone', () => {
    const content = ['- [ ] task A', '  - [x] subtask', '- [/] task B'].join('\n')
    expect(migrate(content)).toBe(
      ['- [ ] @task task A', '  - [x] subtask', '- [/] @task task B'].join('\n')
    )
  })

  it('is a no-op the second time', () => {
    const content = ['- [ ] a', '  - [ ] a1', '- [x] b 📅 2026-09-20'].join('\n')
    const once = migrate(content)
    expect(migrate(once)).toBe(once)
    expect(legacyTaskLines(once)).toEqual([])
  })

  it('preserves CRLF line endings', () => {
    const content = '- [ ] a\r\n  - [ ] a1\r\n'
    expect(migrate(content)).toBe('- [ ] @task a\r\n  - [ ] a1\r\n')
  })

  it('keeps a block anchor last', () => {
    expect(migrate('- [ ] ship it 📅 2026-09-20 ^ship-it')).toBe(
      '- [ ] @task ship it 📅 2026-09-20 ^ship-it'
    )
  })

  it('leaves a fenced sample byte-identical', () => {
    const content = ['- [ ] real', '```', '- [ ] fake', '```'].join('\n')
    expect(migrate(content)).toBe(['- [ ] @task real', '```', '- [ ] fake', '```'].join('\n'))
  })
})

describe('deeply indented legacy checkboxes', () => {
  it('converts one that sits four spaces under prose', () => {
    // These used to be invisible to KNote entirely — masked away as an indented
    // code block — so the migration is the first thing that ever sees them.
    const content = ['Some prose', '', '    - [ ] a task', '      - [ ] its step'].join('\n')
    expect(legacyTaskLines(content)).toEqual([2])
  })

  it('still leaves a fenced sample alone', () => {
    const content = ['Prose', '', '```', '    - [ ] fake', '```'].join('\n')
    expect(legacyTaskLines(content)).toEqual([])
  })
})
