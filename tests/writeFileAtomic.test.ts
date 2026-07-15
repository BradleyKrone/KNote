import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as vault from '../src/core/vaultService'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'knote-atomic-'))
  vault.setVault(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writeFileAtomic', () => {
  it('writes content and reports the new mtime', async () => {
    const result = await vault.writeFileAtomic('a.md', 'hello\n')
    expect(await readFile(join(dir, 'a.md'), 'utf-8')).toBe('hello\n')
    const s = await stat(join(dir, 'a.md'))
    expect(result.mtimeMs).toBe(s.mtimeMs)
  })

  it('refuses to clobber a file modified since expectedMtimeMs', async () => {
    await vault.writeFileAtomic('a.md', 'original\n')
    const before = await stat(join(dir, 'a.md'))
    // External edit with a clearly newer mtime
    await writeFile(join(dir, 'a.md'), 'external edit\n', 'utf-8')
    const later = new Date(Date.now() + 5000)
    await utimes(join(dir, 'a.md'), later, later)

    await expect(vault.writeFileAtomic('a.md', 'mine\n', before.mtimeMs)).rejects.toThrow(
      'KNOTE_CONFLICT'
    )
    expect(await readFile(join(dir, 'a.md'), 'utf-8')).toBe('external edit\n')
  })

  it('accepts a write when expectedMtimeMs still matches', async () => {
    const first = await vault.writeFileAtomic('a.md', 'v1\n')
    await vault.writeFileAtomic('a.md', 'v2\n', first.mtimeMs)
    expect(await readFile(join(dir, 'a.md'), 'utf-8')).toBe('v2\n')
  })

  it('recreates a deleted file even when expectedMtimeMs is given', async () => {
    const first = await vault.writeFileAtomic('a.md', 'v1\n')
    await rm(join(dir, 'a.md'))
    await vault.writeFileAtomic('a.md', 'v2\n', first.mtimeMs)
    expect(await readFile(join(dir, 'a.md'), 'utf-8')).toBe('v2\n')
  })

  it('survives concurrent writes to the same file and leaves no temp files', async () => {
    const contents = Array.from({ length: 10 }, (_, i) => `content ${i}\n`)
    await Promise.all(contents.map((c) => vault.writeFileAtomic('a.md', c)))
    const final = await readFile(join(dir, 'a.md'), 'utf-8')
    expect(contents).toContain(final)
    const leftovers = (await readdir(dir)).filter((f) => f.includes('.knote-tmp'))
    expect(leftovers).toEqual([])
  })

  it('preserves CRLF content byte-exactly', async () => {
    await vault.writeFileAtomic('a.md', 'one\r\ntwo\r\n')
    expect(await readFile(join(dir, 'a.md'), 'utf-8')).toBe('one\r\ntwo\r\n')
  })
})
