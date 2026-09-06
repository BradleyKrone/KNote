import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as vault from '../src/core/vaultService'
import {
  replaceLines,
  appendLine,
  deleteLine,
  insertLine,
  moveLine,
  replaceLine,
  setTaskStatusMeta,
  setTaskTextAndNotes
} from '../src/core/lineEdit'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'knote-lineedit-'))
  vault.setVault(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function seed(name: string, content: string): Promise<void> {
  await writeFile(join(dir, name), content, 'utf-8')
}

async function read(name: string): Promise<string> {
  return readFile(join(dir, name), 'utf-8')
}

describe('replaceLines', () => {
  it('applies every edit in one write', async () => {
    await seed('a.md', 'one\ntwo\nthree\n')
    await replaceLines('a.md', [
      { line: 0, expected: 'one', next: 'ONE' },
      { line: 2, expected: 'three', next: 'THREE' }
    ])
    expect(await read('a.md')).toBe('ONE\ntwo\nTHREE\n')
  })

  it('refuses the whole batch when any one expectation is stale', async () => {
    await seed('a.md', 'one\ntwo\nthree\n')
    await expect(
      replaceLines('a.md', [
        { line: 0, expected: 'one', next: 'ONE' },
        { line: 1, expected: 'missing', next: 'X' }
      ])
    ).rejects.toThrow('KNOTE_STALE')
    // All-or-nothing: the good edit must not have landed either.
    expect(await read('a.md')).toBe('one\ntwo\nthree\n')
  })

  it('tolerates a line having shifted when its text is unique', async () => {
    await seed('a.md', 'inserted\none\ntwo\n')
    await replaceLines('a.md', [{ line: 0, expected: 'two', next: 'TWO' }])
    expect(await read('a.md')).toBe('inserted\none\nTWO\n')
  })

  it('preserves CRLF line endings', async () => {
    await seed('a.md', 'one\r\ntwo\r\n')
    await replaceLines('a.md', [{ line: 1, expected: 'two', next: 'TWO' }])
    expect(await read('a.md')).toBe('one\r\nTWO\r\n')
  })

  it('is a no-op for an empty edit list', async () => {
    await seed('a.md', 'one\n')
    await replaceLines('a.md', [])
    expect(await read('a.md')).toBe('one\n')
  })
})

describe('replaceLine', () => {
  it('rewrites the line at the given number when its text matches', async () => {
    await seed('a.md', 'one\ntwo\nthree\n')
    await replaceLine('a.md', 1, 'two', 'TWO')
    expect(await read('a.md')).toBe('one\nTWO\nthree\n')
  })

  it('tolerates the line having shifted when the text appears exactly once', async () => {
    await seed('a.md', 'inserted\none\ntwo\nthree\n')
    await replaceLine('a.md', 1, 'two', 'TWO')
    expect(await read('a.md')).toBe('inserted\none\nTWO\nthree\n')
  })

  it('rejects with KNOTE_STALE when the expected text is ambiguous', async () => {
    await seed('a.md', 'dup\ndup\nother\n')
    await expect(replaceLine('a.md', 2, 'dup', 'X')).rejects.toThrow('KNOTE_STALE')
    expect(await read('a.md')).toBe('dup\ndup\nother\n')
  })

  it('rejects with KNOTE_STALE when the expected text is gone', async () => {
    await seed('a.md', 'one\ntwo\n')
    await expect(replaceLine('a.md', 0, 'missing', 'X')).rejects.toThrow('KNOTE_STALE')
  })

  it('preserves CRLF line endings', async () => {
    await seed('a.md', 'one\r\ntwo\r\nthree\r\n')
    await replaceLine('a.md', 1, 'two', 'TWO')
    expect(await read('a.md')).toBe('one\r\nTWO\r\nthree\r\n')
  })
})

describe('setTaskStatusMeta', () => {
  it('sets the status char and inserts a reason line under the task', async () => {
    await seed('a.md', '- [ ] @task task\nnext\n')
    await setTaskStatusMeta('a.md', 0, '- [ ] @task task', 'w', {
      reasonLine: '  Reason for Waiting: parts 📅 2026-07-09'
    })
    expect(await read('a.md')).toBe(
      '- [w] @task task\n  Reason for Waiting: parts 📅 2026-07-09\nnext\n'
    )
  })

  it('replaces an existing reason line instead of stacking a second one', async () => {
    await seed('a.md', '- [w] @task task\n  Reason for Waiting: old 📅 2026-07-01\nnext\n')
    await setTaskStatusMeta('a.md', 0, '- [w] @task task', 'b', {
      reasonLine: '  Reason for Blocked: new 📅 2026-07-09'
    })
    expect(await read('a.md')).toBe(
      '- [b] @task task\n  Reason for Blocked: new 📅 2026-07-09\nnext\n'
    )
  })

  it('inserts a status-changed line under the task', async () => {
    await seed('a.md', '- [ ] @task task\nnext\n')
    await setTaskStatusMeta('a.md', 0, '- [ ] @task task', 'x', {
      statusChangedLine: '  - Status Changed: 7/13/2026'
    })
    expect(await read('a.md')).toBe('- [x] @task task\n  - Status Changed: 7/13/2026\nnext\n')
  })

  it('updates a seeded n/a status-changed line in place instead of stacking a new one', async () => {
    await seed(
      'a.md',
      '- [ ] @task task\n  - Status Changed: n/a\n  - Date Entered: 7/13/2026\n  - Notes: \n'
    )
    await setTaskStatusMeta('a.md', 0, '- [ ] @task task', 'x', {
      statusChangedLine: '  - Status Changed: 7/14/2026'
    })
    expect(await read('a.md')).toBe(
      '- [x] @task task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/13/2026\n  - Notes: \n'
    )
  })

  it('updates a status-changed line in place even when a blank line separates it from the task', async () => {
    await seed(
      'a.md',
      '- [/] @task task\n\n  - Status Changed: 7/10/2026\n  - Date Entered: 7/13/2026\n  - Notes: \n'
    )
    await setTaskStatusMeta('a.md', 0, '- [/] @task task', 'x', {
      statusChangedLine: '  - Status Changed: 7/14/2026'
    })
    const out = await read('a.md')
    expect((out.match(/Status Changed:/g) || []).length).toBe(1)
    expect(out).toContain('- Status Changed: 7/14/2026')
    expect(out).toContain('- Date Entered: 7/13/2026')
  })

  it('collapses an already-duplicated status-changed block down to a single line', async () => {
    await seed(
      'a.md',
      '- [/] @task task\n  - Status Changed: 7/13/2026\n\n  - Status Changed: 7/10/2026\n  - Date Entered: 7/13/2026\n  - Notes: \n'
    )
    await setTaskStatusMeta('a.md', 0, '- [/] @task task', 'x', {
      statusChangedLine: '  - Status Changed: 7/15/2026'
    })
    const out = await read('a.md')
    expect((out.match(/Status Changed:/g) || []).length).toBe(1)
    expect(out).toContain('- Status Changed: 7/15/2026')
  })

  it('heals a stray blank line above the note instead of leaving a gap', async () => {
    await seed(
      'a.md',
      '- [/] @task task\n  - Status Changed: 7/13/2026\n\n\n  - Date Entered: 7/13/2026\n  - Notes: \n'
    )
    await setTaskStatusMeta('a.md', 0, '- [/] @task task', 'x', {
      statusChangedLine: '  - Status Changed: 7/14/2026'
    })
    expect(await read('a.md')).toBe(
      '- [x] @task task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/13/2026\n  - Notes: \n'
    )
  })

  it("does not touch a subtask's own status-changed line when the parent changes", async () => {
    await seed(
      'a.md',
      '- [ ] @task parent\n  - Status Changed: 7/1/2026\n  - [ ] child\n    - Status Changed: 7/2/2026\n'
    )
    await setTaskStatusMeta('a.md', 0, '- [ ] @task parent', 'x', {
      statusChangedLine: '  - Status Changed: 7/5/2026'
    })
    expect(await read('a.md')).toBe(
      '- [x] @task parent\n  - Status Changed: 7/5/2026\n  - [ ] child\n    - Status Changed: 7/2/2026\n'
    )
  })

  it('keeps the reason line adjacent to the task and appends status-changed after it', async () => {
    await seed('a.md', '- [w] @task task\n  Reason for Waiting: parts 📅 2026-07-09\nnext\n')
    await setTaskStatusMeta('a.md', 0, '- [w] @task task', 'b', {
      reasonLine: '  Reason for Blocked: new 📅 2026-07-09',
      statusChangedLine: '  - Status Changed: 7/13/2026'
    })
    expect(await read('a.md')).toBe(
      '- [b] @task task\n  Reason for Blocked: new 📅 2026-07-09\n  - Status Changed: 7/13/2026\nnext\n'
    )
  })

  it('preserves an existing status-changed line when only the reason is being updated', async () => {
    await seed(
      'a.md',
      '- [w] @task task\n  Reason for Waiting: parts 📅 2026-07-01\n  - Status Changed: 7/1/2026\nnext\n'
    )
    await setTaskStatusMeta('a.md', 0, '- [w] @task task', 'w', {
      reasonLine: '  Reason for Waiting: still parts 📅 2026-07-09'
    })
    expect(await read('a.md')).toBe(
      '- [w] @task task\n  Reason for Waiting: still parts 📅 2026-07-09\n  - Status Changed: 7/1/2026\nnext\n'
    )
  })

  it('deletes the reason line — follow-up date and all — on a move to a column that needs no reason', async () => {
    await seed(
      'a.md',
      '- [w] @task task\n  Reason for Waiting: parts ⏳ 2026-08-04\n  - Status Changed: 7/1/2026\n  - Notes: keep me\nnext\n'
    )
    await setTaskStatusMeta('a.md', 0, '- [w] @task task', '/', {
      reasonLine: null,
      statusChangedLine: '  - Status Changed: 7/13/2026'
    })
    const after = await read('a.md')
    expect(after).toBe(
      '- [/] @task task\n  - Status Changed: 7/13/2026\n  - Notes: keep me\nnext\n'
    )
    // The date rides on the reason line, so it must go with it — a follow-up
    // date stranded on a card that has left Waiting is the stale-chip bug.
    expect(after).not.toContain('⏳')
    expect(after).not.toContain('2026-08-04')
  })

  it('deletes a legacy 📅 reason line on a move out just the same', async () => {
    // Notes written before the date meant "follow up" must still be cleaned up
    // on the way out, or they keep a chip forever.
    await seed(
      'a.md',
      '- [w] @task task\n  Reason for Waiting: parts 📅 2026-07-01\n  - Notes: keep me\n'
    )
    await setTaskStatusMeta('a.md', 0, '- [w] @task task', '/', { reasonLine: null })
    const after = await read('a.md')
    expect(after).toBe('- [/] @task task\n  - Notes: keep me\n')
    expect(after).not.toContain('📅')
  })

  it('leaves no blank line behind when the reason was the task’s whole note block', async () => {
    await seed('a.md', '- [w] @task task\n  Reason for Waiting: parts 📅 2026-07-01\nnext\n')
    await setTaskStatusMeta('a.md', 0, '- [w] @task task', '/', { reasonLine: null })
    expect(await read('a.md')).toBe('- [/] @task task\nnext\n')
  })

  it('keeps an existing reason line when no reason update is supplied', async () => {
    await seed('a.md', '- [w] @task task\n  Reason for Waiting: parts 📅 2026-07-01\nnext\n')
    await setTaskStatusMeta('a.md', 0, '- [w] @task task', 'w', {
      statusChangedLine: '  - Status Changed: 7/13/2026'
    })
    expect(await read('a.md')).toBe(
      '- [w] @task task\n  Reason for Waiting: parts 📅 2026-07-01\n  - Status Changed: 7/13/2026\nnext\n'
    )
  })

  it('rejects with KNOTE_STALE when the line is not a task', async () => {
    await seed('a.md', 'not a task\n')
    await expect(
      setTaskStatusMeta('a.md', 0, 'not a task', 'w', {
        reasonLine: '  Reason for W: x 📅 2026-07-09'
      })
    ).rejects.toThrow('KNOTE_STALE')
  })
})

describe('deleteLine', () => {
  it('removes the verified line', async () => {
    await seed('a.md', 'one\ntwo\nthree\n')
    await deleteLine('a.md', 1, 'two')
    expect(await read('a.md')).toBe('one\nthree\n')
  })

  it('rejects with KNOTE_STALE when the text moved and is ambiguous', async () => {
    await seed('a.md', 'x\nx\n')
    await expect(deleteLine('a.md', 5, 'x')).rejects.toThrow('KNOTE_STALE')
  })
})

describe('moveLine', () => {
  it('moves a line before the target line', async () => {
    await seed('a.md', 'a\nb\nc\nd\n')
    await moveLine('a.md', 2, 'c', 0, 'a')
    expect(await read('a.md')).toBe('c\na\nb\nd\n')
  })

  it('moves a line to the end when beforeLine is -1', async () => {
    await seed('a.md', 'a\nb\nc\n')
    await moveLine('a.md', 0, 'a', -1, null)
    // trailing empty segment from the final \n sits after the moved line
    expect(await read('a.md')).toBe('b\nc\n\na')
  })

  it('adjusts the destination when moving a line downward', async () => {
    await seed('a.md', 'a\nb\nc\nd\n')
    await moveLine('a.md', 0, 'a', 3, 'd')
    expect(await read('a.md')).toBe('b\nc\na\nd\n')
  })

  it('rejects with KNOTE_STALE when the target line changed', async () => {
    await seed('a.md', 'a\nb\n')
    await expect(moveLine('a.md', 0, 'a', 1, 'gone')).rejects.toThrow('KNOTE_STALE')
  })
})

describe('insertLine', () => {
  it('inserts directly below its anchor line', async () => {
    await seed('a.md', 'one\ntwo\nthree\n')
    await insertLine('a.md', 1, 'two', 'TWO-AND-A-HALF')
    expect(await read('a.md')).toBe('one\ntwo\nTWO-AND-A-HALF\nthree\n')
  })

  it('refuses when the anchor line changed on disk', async () => {
    await seed('a.md', 'one\nedited\nthree\n')
    await expect(insertLine('a.md', 1, 'two', 'new')).rejects.toThrow(/KNOTE_STALE/)
    expect(await read('a.md')).toBe('one\nedited\nthree\n')
  })

  it('follows the anchor when it has shifted and is unambiguous', async () => {
    await seed('a.md', 'zero\none\ntwo\nthree\n')
    await insertLine('a.md', 1, 'two', 'new')
    expect(await read('a.md')).toBe('zero\none\ntwo\nnew\nthree\n')
  })

  it('preserves CRLF line endings', async () => {
    await seed('a.md', 'one\r\ntwo\r\nthree\r\n')
    await insertLine('a.md', 1, 'two', 'new')
    expect(await read('a.md')).toBe('one\r\ntwo\r\nnew\r\nthree\r\n')
  })
})

describe('appendLine', () => {
  it('creates the note when it does not exist', async () => {
    await appendLine('new.md', '- [ ] @task captured')
    expect(await read('new.md')).toBe('- [ ] @task captured\n')
  })

  it('appends after content that lacks a trailing newline', async () => {
    await seed('a.md', 'one')
    await appendLine('a.md', 'two')
    expect(await read('a.md')).toBe('one\ntwo\n')
  })

  it('appends to content with a trailing newline', async () => {
    await seed('a.md', 'one\n')
    await appendLine('a.md', 'two')
    expect(await read('a.md')).toBe('one\ntwo\n')
  })

  it('preserves CRLF line endings', async () => {
    await seed('a.md', 'one\r\ntwo')
    await appendLine('a.md', 'three')
    expect(await read('a.md')).toBe('one\r\ntwo\r\nthree\r\n')
  })
})

/**
 * The disk half of the board's task editor. The live-buffer half lives in
 * `verifiedEdit` and is covered by `test/integration/taskNotesEdit.test.ts`;
 * both consume the same `planTaskMetaEdit` splice.
 */
describe('setTaskTextAndNotes', () => {
  const seeded =
    '- [ ] @task task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/1/2026\n  - Notes: original\n- [ ] @task sibling\n'

  it('rewrites the line and the note body in one write, keeping the managed lines', async () => {
    await seed('a.md', seeded)
    await setTaskTextAndNotes('a.md', 0, '- [ ] @task task', '- [ ] @task renamed #tag', [
      '  - Notes: rewritten'
    ])
    expect(await read('a.md')).toBe(
      '- [ ] @task renamed #tag\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/1/2026\n  - Notes: rewritten\n- [ ] @task sibling\n'
    )
  })

  it('leaves the sibling task below untouched', async () => {
    await seed('a.md', seeded)
    await setTaskTextAndNotes('a.md', 0, '- [ ] @task task', '- [ ] @task task', ['  - Notes: x'])
    expect(await read('a.md')).toContain('- [ ] @task sibling\n')
  })

  it('re-stamps Status Changed and writes a reason when the task editor moves the column', async () => {
    await seed('a.md', seeded)
    await setTaskTextAndNotes(
      'a.md',
      0,
      '- [ ] @task task',
      '- [w] @task task',
      ['  - Notes: original'],
      undefined,
      {
        reasonLine: '  - Reason for Waiting: parts 📅 2026-09-01',
        statusChangedLine: '  - Status Changed: 8/19/2026'
      }
    )
    expect(await read('a.md')).toBe(
      '- [w] @task task\n  - Reason for Waiting: parts 📅 2026-09-01\n  - Status Changed: 8/19/2026\n  - Date Entered: 7/1/2026\n  - Notes: original\n- [ ] @task sibling\n'
    )
  })

  it('drops the reason line when the same save moves the task out of that column', async () => {
    await seed(
      'a.md',
      '- [w] @task task\n  - Reason for Waiting: parts 📅 2026-09-01\n  - Status Changed: 7/14/2026\n  - Notes: original\n'
    )
    await setTaskTextAndNotes(
      'a.md',
      0,
      '- [w] @task task',
      '- [x] @task task',
      ['  - Notes: original'],
      undefined,
      { reasonLine: null, statusChangedLine: '  - Status Changed: 8/19/2026' }
    )
    expect(await read('a.md')).toBe(
      '- [x] @task task\n  - Status Changed: 8/19/2026\n  - Notes: original\n'
    )
  })

  it('adds a note block to a task that had none', async () => {
    await seed('a.md', '- [ ] @task bare\n- [ ] @task next\n')
    await setTaskTextAndNotes('a.md', 0, '- [ ] @task bare', '- [ ] @task bare', [
      '  - Notes: brand new'
    ])
    expect(await read('a.md')).toBe('- [ ] @task bare\n  - Notes: brand new\n- [ ] @task next\n')
  })

  it('clears the body without leaving a blank line behind', async () => {
    await seed('a.md', '- [ ] @task t\n  - Notes: gone\n- [ ] @task next\n')
    await setTaskTextAndNotes('a.md', 0, '- [ ] @task t', '- [ ] @task t', [])
    expect(await read('a.md')).toBe('- [ ] @task t\n- [ ] @task next\n')
  })

  it('preserves the ^block anchor the caller carries over', async () => {
    await seed('a.md', '- [ ] @task task ^abc123\n  - Notes: n\n')
    await setTaskTextAndNotes(
      'a.md',
      0,
      '- [ ] @task task ^abc123',
      '- [ ] @task renamed ^abc123',
      ['  - Notes: n']
    )
    expect(await read('a.md')).toBe('- [ ] @task renamed ^abc123\n  - Notes: n\n')
  })

  it('keeps a CRLF file CRLF throughout', async () => {
    await seed('a.md', '- [ ] @task t\r\n  - Notes: old\r\n- [ ] @task next\r\n')
    await setTaskTextAndNotes('a.md', 0, '- [ ] @task t', '- [ ] @task t2', ['  - Notes: new'])
    expect(await read('a.md')).toBe('- [ ] @task t2\r\n  - Notes: new\r\n- [ ] @task next\r\n')
  })

  it('handles a task on the last line of the file', async () => {
    await seed('a.md', 'intro\n- [ ] @task last\n')
    await setTaskTextAndNotes('a.md', 1, '- [ ] @task last', '- [ ] @task last!', ['  - Notes: n'])
    expect(await read('a.md')).toBe('intro\n- [ ] @task last!\n  - Notes: n\n')
  })

  it('refuses with KNOTE_STALE and writes nothing when the line moved', async () => {
    await seed('a.md', '- [ ] @task changed on disk\n')
    await expect(
      setTaskTextAndNotes('a.md', 0, '- [ ] @task task', '- [ ] @task x', ['  - Notes: n'])
    ).rejects.toThrow(/KNOTE_STALE/)
    expect(await read('a.md')).toBe('- [ ] @task changed on disk\n')
  })

  it('refuses when the located line is no longer a task line', async () => {
    await seed('a.md', 'plain text\n')
    await expect(setTaskTextAndNotes('a.md', 0, 'plain text', '- [ ] @task x', [])).rejects.toThrow(
      /KNOTE_STALE/
    )
    expect(await read('a.md')).toBe('plain text\n')
  })
})
