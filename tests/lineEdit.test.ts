import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as vault from '../src/main/vaultService'
import {
  appendLine,
  deleteLine,
  moveLine,
  replaceLine,
  setTaskStatusMeta
} from '../src/main/lineEdit'

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
    await seed('a.md', '- [ ] task\nnext\n')
    await setTaskStatusMeta('a.md', 0, '- [ ] task', 'w', {
      reasonLine: '  Reason for Waiting: parts 📅 2026-07-09'
    })
    expect(await read('a.md')).toBe('- [w] task\n  Reason for Waiting: parts 📅 2026-07-09\nnext\n')
  })

  it('replaces an existing reason line instead of stacking a second one', async () => {
    await seed('a.md', '- [w] task\n  Reason for Waiting: old 📅 2026-07-01\nnext\n')
    await setTaskStatusMeta('a.md', 0, '- [w] task', 'b', {
      reasonLine: '  Reason for Blocked: new 📅 2026-07-09'
    })
    expect(await read('a.md')).toBe('- [b] task\n  Reason for Blocked: new 📅 2026-07-09\nnext\n')
  })

  it('inserts a status-changed line under the task', async () => {
    await seed('a.md', '- [ ] task\nnext\n')
    await setTaskStatusMeta('a.md', 0, '- [ ] task', 'x', {
      statusChangedLine: '  - Status Changed: 7/13/2026'
    })
    expect(await read('a.md')).toBe('- [x] task\n  - Status Changed: 7/13/2026\nnext\n')
  })

  it('updates a seeded n/a status-changed line in place instead of stacking a new one', async () => {
    await seed(
      'a.md',
      '- [ ] task\n  - Status Changed: n/a\n  - Date Entered: 7/13/2026\n  - Notes: \n'
    )
    await setTaskStatusMeta('a.md', 0, '- [ ] task', 'x', {
      statusChangedLine: '  - Status Changed: 7/14/2026'
    })
    expect(await read('a.md')).toBe(
      '- [x] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/13/2026\n  - Notes: \n'
    )
  })

  it('updates a status-changed line in place even when a blank line separates it from the task', async () => {
    await seed(
      'a.md',
      '- [/] task\n\n  - Status Changed: 7/10/2026\n  - Date Entered: 7/13/2026\n  - Notes: \n'
    )
    await setTaskStatusMeta('a.md', 0, '- [/] task', 'x', {
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
      '- [/] task\n  - Status Changed: 7/13/2026\n\n  - Status Changed: 7/10/2026\n  - Date Entered: 7/13/2026\n  - Notes: \n'
    )
    await setTaskStatusMeta('a.md', 0, '- [/] task', 'x', {
      statusChangedLine: '  - Status Changed: 7/15/2026'
    })
    const out = await read('a.md')
    expect((out.match(/Status Changed:/g) || []).length).toBe(1)
    expect(out).toContain('- Status Changed: 7/15/2026')
  })

  it('heals a stray blank line above the note instead of leaving a gap', async () => {
    await seed(
      'a.md',
      '- [/] task\n  - Status Changed: 7/13/2026\n\n\n  - Date Entered: 7/13/2026\n  - Notes: \n'
    )
    await setTaskStatusMeta('a.md', 0, '- [/] task', 'x', {
      statusChangedLine: '  - Status Changed: 7/14/2026'
    })
    expect(await read('a.md')).toBe(
      '- [x] task\n  - Status Changed: 7/14/2026\n  - Date Entered: 7/13/2026\n  - Notes: \n'
    )
  })

  it("does not touch a subtask's own status-changed line when the parent changes", async () => {
    await seed(
      'a.md',
      '- [ ] parent\n  - Status Changed: 7/1/2026\n  - [ ] child\n    - Status Changed: 7/2/2026\n'
    )
    await setTaskStatusMeta('a.md', 0, '- [ ] parent', 'x', {
      statusChangedLine: '  - Status Changed: 7/5/2026'
    })
    expect(await read('a.md')).toBe(
      '- [x] parent\n  - Status Changed: 7/5/2026\n  - [ ] child\n    - Status Changed: 7/2/2026\n'
    )
  })

  it('keeps the reason line adjacent to the task and appends status-changed after it', async () => {
    await seed('a.md', '- [w] task\n  Reason for Waiting: parts 📅 2026-07-09\nnext\n')
    await setTaskStatusMeta('a.md', 0, '- [w] task', 'b', {
      reasonLine: '  Reason for Blocked: new 📅 2026-07-09',
      statusChangedLine: '  - Status Changed: 7/13/2026'
    })
    expect(await read('a.md')).toBe(
      '- [b] task\n  Reason for Blocked: new 📅 2026-07-09\n  - Status Changed: 7/13/2026\nnext\n'
    )
  })

  it('preserves an existing status-changed line when only the reason is being updated', async () => {
    await seed(
      'a.md',
      '- [w] task\n  Reason for Waiting: parts 📅 2026-07-01\n  - Status Changed: 7/1/2026\nnext\n'
    )
    await setTaskStatusMeta('a.md', 0, '- [w] task', 'w', {
      reasonLine: '  Reason for Waiting: still parts 📅 2026-07-09'
    })
    expect(await read('a.md')).toBe(
      '- [w] task\n  Reason for Waiting: still parts 📅 2026-07-09\n  - Status Changed: 7/1/2026\nnext\n'
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

describe('appendLine', () => {
  it('creates the note when it does not exist', async () => {
    await appendLine('new.md', '- [ ] captured')
    expect(await read('new.md')).toBe('- [ ] captured\n')
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
