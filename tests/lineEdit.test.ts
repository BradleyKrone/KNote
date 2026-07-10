import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as vault from '../src/main/vaultService'
import { appendLine, deleteLine, moveLine, replaceLine, setTaskStatusReason } from '../src/main/lineEdit'

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

describe('setTaskStatusReason', () => {
  it('sets the status char and inserts a reason line under the task', async () => {
    await seed('a.md', '- [ ] task\nnext\n')
    await setTaskStatusReason('a.md', 0, '- [ ] task', 'w', '  Reason for Waiting: parts 📅 2026-07-09')
    expect(await read('a.md')).toBe('- [w] task\n  Reason for Waiting: parts 📅 2026-07-09\nnext\n')
  })

  it('replaces an existing reason line instead of stacking a second one', async () => {
    await seed('a.md', '- [w] task\n  Reason for Waiting: old 📅 2026-07-01\nnext\n')
    await setTaskStatusReason('a.md', 0, '- [w] task', 'b', '  Reason for Blocked: new 📅 2026-07-09')
    expect(await read('a.md')).toBe('- [b] task\n  Reason for Blocked: new 📅 2026-07-09\nnext\n')
  })

  it('rejects with KNOTE_STALE when the line is not a task', async () => {
    await seed('a.md', 'not a task\n')
    await expect(
      setTaskStatusReason('a.md', 0, 'not a task', 'w', '  Reason for W: x 📅 2026-07-09')
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
