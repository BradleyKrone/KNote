import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import * as vault from '../src/core/vaultService'

let primary: string
let mount: string

beforeEach(async () => {
  primary = await mkdtemp(join(tmpdir(), 'knote-primary-'))
  mount = await mkdtemp(join(tmpdir(), 'knote-mount-'))
  vault.setVault(primary)
  vault.setMounts([{ name: 'repo', root: mount }])
})

afterEach(async () => {
  vault.setMounts([])
  await rm(primary, { recursive: true, force: true })
  await rm(mount, { recursive: true, force: true })
})

describe('toAbs with mounts', () => {
  it('routes a mount-prefixed path into that mount, not the vault root', () => {
    expect(vault.toAbs('repo/docs/x.md')).toBe(resolve(mount, 'docs/x.md'))
  })

  it('resolves the bare mount name to the mount root', () => {
    expect(vault.toAbs('repo')).toBe(resolve(mount))
  })

  it('matches the mount name case-insensitively, like the filesystem', () => {
    expect(vault.toAbs('REPO/x.md')).toBe(resolve(mount, 'x.md'))
  })

  it('leaves everything else in the primary root', () => {
    expect(vault.toAbs('Weekly/x.md')).toBe(resolve(primary, 'Weekly/x.md'))
  })

  it('still refuses a path that climbs out of a mount', () => {
    expect(() => vault.toAbs('repo/../..')).toThrow(/Invalid path/)
  })
})

describe('relForAbs', () => {
  it('round-trips a path in the primary root', () => {
    expect(vault.relForAbs(join(primary, 'Weekly', 'x.md'))).toBe('Weekly/x.md')
  })

  it('prefixes a path inside a mount with the mount name', () => {
    expect(vault.relForAbs(join(mount, 'docs', 'x.md'))).toBe('repo/docs/x.md')
  })

  it("gives '' for the primary root and the mount name for a mount root", () => {
    // The watcher relies on telling these apart: '' is the vault itself, and a
    // bare mount name must survive its own ignore rules.
    expect(vault.relForAbs(primary)).toBe('')
    expect(vault.relForAbs(mount)).toBe('repo')
  })

  it('returns null outside every root', () => {
    expect(vault.relForAbs(resolve(tmpdir(), 'somewhere-else', 'x.md'))).toBeNull()
  })

  it('returns null with no vault open rather than throwing', () => {
    vault.setMounts([])
    // The watcher calls this from callbacks that can outlive the vault.
    expect(() => vault.relForAbs('C:/anything')).not.toThrow()
  })
})

describe("mount roots are not the vault's to destroy", () => {
  it('identifies a mount root, but not a folder inside it', () => {
    expect(vault.isMountRoot('repo')).toBe(true)
    expect(vault.isMountRoot('REPO')).toBe(true)
    expect(vault.isMountRoot('repo/docs')).toBe(false)
    expect(vault.isMountRoot('Weekly')).toBe(false)
  })

  it('refuses to trash a mounted folder', async () => {
    await expect(vault.deleteEntry('repo')).rejects.toThrow(/mounted from outside/)
  })

  it('refuses to hard-delete a mounted folder', async () => {
    await expect(vault.deleteEntryPermanently('repo')).rejects.toThrow(/mounted from outside/)
  })

  it('still deletes things inside a mount', async () => {
    await writeFile(join(mount, 'note.md'), 'x')
    await vault.deleteEntryPermanently('repo/note.md')
    expect((await vault.readDir('repo')).map((e) => e.name)).not.toContain('note.md')
  })
})

describe('readDir at the vault root', () => {
  it('lists mounts as folders, sorted in with the real ones', async () => {
    for (const name of ['Alpha', 'Zulu']) await mkdir(join(primary, name))
    const names = (await vault.readDir('')).map((e) => e.name)
    expect(names).toEqual(['Alpha', 'repo', 'Zulu'])
  })

  it('hides an on-disk folder shadowed by a mount, which toAbs cannot reach', async () => {
    await mkdir(join(primary, 'repo'))
    const rows = (await vault.readDir('')).filter((e) => e.name === 'repo')
    expect(rows).toHaveLength(1)
    expect(vault.toAbs('repo')).toBe(resolve(mount))
  })

  it('reads inside a mount like any other folder', async () => {
    await writeFile(join(mount, 'note.md'), 'x')
    expect((await vault.readDir('repo')).map((e) => e.path)).toEqual(['repo/note.md'])
  })

  it('spans mounts in buildTree', async () => {
    await writeFile(join(mount, 'note.md'), 'x')
    const tree = await vault.buildTree()
    const repo = tree.find((e) => e.name === 'repo')
    expect(repo?.children?.map((c) => c.path)).toEqual(['repo/note.md'])
  })
})

describe('writes land in the right root', () => {
  it('creates a note inside the mount, not the vault', async () => {
    const path = await vault.createFile('repo/New Note.md', 'body')
    expect(path).toBe('repo/New Note.md')
    const read = await vault.readFile('repo/New Note.md')
    expect(read.content).toContain('body')
  })

  it('writes atomically inside the mount', async () => {
    await vault.createFile('repo/n.md', 'one')
    await vault.writeFileAtomic('repo/n.md', 'two')
    expect((await vault.readFile('repo/n.md')).content).toBe('two')
  })
})
