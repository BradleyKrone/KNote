import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { markKnownContent, markOwnWrite, shouldReportChange, stopWatching } from '../src/main/watcher'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'knote-watcher-'))
})

afterEach(async () => {
  await stopWatching() // clears own-write and known-hash state between tests
  await rm(dir, { recursive: true, force: true })
})

describe('shouldReportChange', () => {
  it('suppresses the echo of our own content write', async () => {
    const abs = join(dir, 'a.md')
    await writeFile(abs, 'saved by knote\n', 'utf-8')
    markOwnWrite(abs, 'saved by knote\n')
    expect(await shouldReportChange(abs, 'change')).toBe(false)
  })

  it('reports an external edit that lands right after our own write', async () => {
    const abs = join(dir, 'a.md')
    markOwnWrite(abs, 'what knote wrote\n')
    await writeFile(abs, 'external content\n', 'utf-8')
    expect(await shouldReportChange(abs, 'change')).toBe(true)
  })

  it('suppresses a byte-identical re-touch of known content (sync client)', async () => {
    const abs = join(dir, 'a.md')
    await writeFile(abs, 'stable content\n', 'utf-8')
    markKnownContent(abs, 'stable content\n')
    expect(await shouldReportChange(abs, 'change')).toBe(false)
  })

  it('suppresses identical re-touches with no TTL (long after the read)', async () => {
    const abs = join(dir, 'a.md')
    await writeFile(abs, 'stable content\n', 'utf-8')
    markKnownContent(abs, 'stable content\n')
    // First event consumed, second identical touch still suppressed
    expect(await shouldReportChange(abs, 'change')).toBe(false)
    expect(await shouldReportChange(abs, 'change')).toBe(false)
  })

  it('reports a genuine external change on an untracked file', async () => {
    const abs = join(dir, 'a.md')
    await writeFile(abs, 'brand new\n', 'utf-8')
    expect(await shouldReportChange(abs, 'add')).toBe(true)
  })

  it('reports a real content change to known content, then suppresses its re-touch', async () => {
    const abs = join(dir, 'a.md')
    markKnownContent(abs, 'old\n')
    await writeFile(abs, 'new\n', 'utf-8')
    expect(await shouldReportChange(abs, 'change')).toBe(true)
    // The change updated the baseline: an identical follow-up touch is an echo
    expect(await shouldReportChange(abs, 'change')).toBe(false)
  })

  it('suppresses structural ops via the own-write TTL fallback', async () => {
    const abs = join(dir, 'a.md')
    markOwnWrite(abs) // no content: rename/move/delete marker
    expect(await shouldReportChange(abs, 'unlink')).toBe(false)
  })

  it('is case-insensitive about paths (Windows)', async () => {
    const abs = join(dir, 'Note.md')
    await writeFile(abs, 'content\n', 'utf-8')
    markKnownContent(abs.toUpperCase(), 'content\n')
    expect(await shouldReportChange(abs, 'change')).toBe(false)
  })
})
