import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as vault from '../src/core/vaultService'
import { toRelSafe } from '../src/core/watcher'

let primary: string
let mount: string

beforeEach(async () => {
  primary = await mkdtemp(join(tmpdir(), 'knote-w-primary-'))
  mount = await mkdtemp(join(tmpdir(), 'knote-w-mount-'))
  vault.setVault(primary)
  vault.setMounts([{ name: 'repo', root: mount }])
})

afterEach(async () => {
  vault.setMounts([])
  await rm(primary, { recursive: true, force: true })
  await rm(mount, { recursive: true, force: true })
})

describe('watcher event paths across roots', () => {
  it('names an event in the vault relative to the vault', () => {
    expect(toRelSafe(join(primary, 'Weekly', 'x.md'))).toBe('Weekly/x.md')
  })

  it('prefixes an event in a mount with the mount name', () => {
    expect(toRelSafe(join(mount, 'docs', 'x.md'))).toBe('repo/docs/x.md')
  })

  it("distinguishes the vault root ('') from a mount root (its name)", () => {
    // The `ignored` predicate lets '' through so a watched root isn't refused
    // by its own rules; a mount root has to survive the same way, and it can
    // only do that by being named rather than collapsing to ''.
    expect(toRelSafe(primary)).toBe('')
    expect(toRelSafe(mount)).toBe('repo')
  })

  it('ignores an event from outside every root', () => {
    expect(toRelSafe(join(tmpdir(), 'unrelated', 'x.md'))).toBeNull()
  })
})
