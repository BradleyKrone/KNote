import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as vault from '../src/core/vaultService'
import * as vaultIndex from '../src/core/indexer/vaultIndex'
import { resolveTarget } from '../src/shared/wikiResolve'

let primary: string
let mount: string

beforeEach(async () => {
  primary = await mkdtemp(join(tmpdir(), 'knote-idx-primary-'))
  mount = await mkdtemp(join(tmpdir(), 'knote-idx-mount-'))
  vault.setVault(primary)
  vault.setMounts([{ name: 'repo', root: mount }])
})

afterEach(async () => {
  vault.setMounts([])
  await rm(primary, { recursive: true, force: true })
  await rm(mount, { recursive: true, force: true })
})

describe('indexing a vault that spans folders', () => {
  it('indexes notes in a mount under the mount-prefixed path', async () => {
    await writeFile(join(primary, 'Home.md'), '# Home')
    await mkdir(join(mount, 'docs'))
    await writeFile(join(mount, 'docs', 'Post.md'), '# Post')

    await vaultIndex.initIndex()

    expect(vaultIndex.getSnapshot().map((m) => m.path)).toEqual(['Home.md', 'repo/docs/Post.md'])
  })

  it('same-named notes in two roots do not collide — the prefix separates them', async () => {
    await writeFile(join(primary, 'README.md'), 'vault readme')
    await writeFile(join(mount, 'README.md'), 'repo readme')

    await vaultIndex.initIndex()

    expect(vaultIndex.getSnapshot()).toHaveLength(2)
    expect(vaultIndex.getContent('README.md')).toBe('vault readme')
    expect(vaultIndex.getContent('repo/README.md')).toBe('repo readme')
  })

  it("skips a mount's .git and node_modules, so a busy repo is not swept in", async () => {
    await mkdir(join(mount, '.git'))
    await writeFile(join(mount, '.git', 'COMMIT_EDITMSG.md'), 'x')
    await mkdir(join(mount, 'node_modules'))
    await writeFile(join(mount, 'node_modules', 'readme.md'), 'x')
    await writeFile(join(mount, 'Real.md'), 'x')

    await vaultIndex.initIndex()

    expect(vaultIndex.getSnapshot().map((m) => m.path)).toEqual(['repo/Real.md'])
  })

  it('resolves a shared title to the vault copy, not the mounted one', async () => {
    // resolveTarget breaks title ties by taking the first match it iterates
    // past, so this is decided entirely by getSnapshot's order — and left to
    // index-completion order it would have been a coin flip per run.
    await writeFile(join(primary, 'README.md'), 'vault')
    await writeFile(join(mount, 'README.md'), 'repo')

    await vaultIndex.initIndex()
    const notes = new Map(vaultIndex.getSnapshot().map((m) => [m.path, m]))

    expect(resolveTarget('README', notes)).toBe('README.md')
    // An explicitly prefixed link still reaches the mounted one.
    expect(resolveTarget('repo/README', notes)).toBe('repo/README.md')
  })

  it('gives the same order every run', async () => {
    await writeFile(join(primary, 'zoo.md'), 'z')
    await writeFile(join(mount, 'alpha.md'), 'a')

    await vaultIndex.initIndex()
    const first = vaultIndex.getSnapshot().map((m) => m.path)
    await vaultIndex.initIndex()

    expect(vaultIndex.getSnapshot().map((m) => m.path)).toEqual(first)
    expect(first).toEqual(['zoo.md', 'repo/alpha.md'])
  })
})
