import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as vault from '../src/core/vaultService'

describe('buildTree ordering', () => {
  it('sorts numbered file names chronologically, not lexicographically', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-test-'))
    try {
      vault.setVault(dir)
      await mkdir(join(dir, 'Notes'))
      for (const name of ['2026-9-1.md', '2026-12-1.md', '2026-2-1.md']) {
        await writeFile(join(dir, 'Notes', name), '')
      }
      const tree = await vault.buildTree()
      const notes = tree.find((e) => e.name === 'Notes')!.children!.map((e) => e.name)
      expect(notes).toEqual(['2026-2-1.md', '2026-9-1.md', '2026-12-1.md'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('lists the weekly notes folder newest-first', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-test-'))
    try {
      vault.setVault(dir)
      await mkdir(join(dir, 'Weekly'))
      for (const name of ['2026-1-5.md', '2026-7-6.md', '2026-3-2.md']) {
        await writeFile(join(dir, 'Weekly', name), '')
      }
      const tree = await vault.buildTree()
      const notes = tree.find((e) => e.name === 'Weekly')!.children!.map((e) => e.name)
      expect(notes).toEqual(['2026-7-6.md', '2026-3-2.md', '2026-1-5.md'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
