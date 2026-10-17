import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as vault from '../src/core/vaultService'
import { existsSync } from 'fs'

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

  it('lists year and month folders under the weekly folder newest-first too', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-test-'))
    try {
      vault.setVault(dir)
      for (const rel of [
        '2025/12 December/2025-12-29.md',
        '2026/09 September/2026-9-28.md',
        '2026/10 October/2026-10-5.md',
        '2026/10 October/2026-10-12.md'
      ]) {
        await mkdir(join(dir, 'Weekly', rel, '..'), { recursive: true })
        await writeFile(join(dir, 'Weekly', rel), '')
      }
      await mkdir(join(dir, 'Notes', 'B'), { recursive: true })
      await mkdir(join(dir, 'Notes', 'A'), { recursive: true })

      const tree = await vault.buildTree()
      const weekly = tree.find((e) => e.name === 'Weekly')!.children!
      expect(weekly.map((e) => e.name)).toEqual(['2026', '2025'])
      const y2026 = weekly[0].children!
      expect(y2026.map((e) => e.name)).toEqual(['10 October', '09 September'])
      expect(y2026[0].children!.map((e) => e.name)).toEqual(['2026-10-12.md', '2026-10-5.md'])
      // Folders elsewhere stay A-Z.
      const notes = tree.find((e) => e.name === 'Notes')!.children!
      expect(notes.map((e) => e.name)).toEqual(['A', 'B'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('readDir', () => {
  it('reads one level only, folders before files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-test-'))
    try {
      vault.setVault(dir)
      await mkdir(join(dir, 'Clients', 'Acme'), { recursive: true })
      await writeFile(join(dir, 'Clients', 'Acme', 'Deep.md'), '')
      await writeFile(join(dir, 'Clients', 'Index.md'), '')
      await writeFile(join(dir, 'Root.md'), '')

      const root = await vault.readDir('')
      expect(root.map((e) => [e.name, e.kind])).toEqual([
        ['Clients', 'folder'],
        ['Root.md', 'file']
      ])
      // Folders come back unexpanded — the caller fetches children on demand.
      expect(root[0].children).toBeUndefined()

      const clients = await vault.readDir('Clients')
      expect(clients.map((e) => e.name)).toEqual(['Acme', 'Index.md'])
      expect(clients[0].path).toBe('Clients/Acme')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('shows every kind of file a vault holds, not just notes and images', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-test-'))
    try {
      vault.setVault(dir)
      for (const name of ['Note.md', 'Shot.png', 'Spec.pdf', 'Flow.drawio', 'data.csv']) {
        await writeFile(join(dir, name), '')
      }
      const names = (await vault.readDir('')).map((e) => e.name)
      expect(names).toEqual(['data.csv', 'Flow.drawio', 'Note.md', 'Shot.png', 'Spec.pdf'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('hides dotfiles, ignored folders and in-flight atomic-write temp files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-test-'))
    try {
      vault.setVault(dir)
      await mkdir(join(dir, '.knote'))
      await mkdir(join(dir, '.git'))
      await mkdir(join(dir, 'node_modules'))
      await writeFile(join(dir, '.knote', 'config.json'), '{}')
      await writeFile(join(dir, '.hidden'), '')
      await writeFile(join(dir, 'Note.md.1234-0.knote-tmp'), '')
      await writeFile(join(dir, 'Note.md'), '')

      expect((await vault.readDir('')).map((e) => e.name)).toEqual(['Note.md'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('is empty for a folder that does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-test-'))
    try {
      vault.setVault(dir)
      expect(await vault.readDir('Nope')).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses to read outside the vault', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-test-'))
    try {
      vault.setVault(dir)
      await expect(vault.readDir('../..')).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('deleteEntryPermanently', () => {
  it('hard-deletes a file without going through the trash handler', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-test-'))
    try {
      vault.setVault(dir)
      await writeFile(join(dir, 'Note.md'), '')
      // No setTrashHandler call in this file, so the default handler still
      // throws — deleteEntryPermanently resolving proves it never touched it.
      await vault.deleteEntryPermanently('Note.md')
      expect(existsSync(join(dir, 'Note.md'))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('hard-deletes a folder recursively', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-test-'))
    try {
      vault.setVault(dir)
      await mkdir(join(dir, 'Clients', 'Acme'), { recursive: true })
      await writeFile(join(dir, 'Clients', 'Acme', 'Deep.md'), '')
      await vault.deleteEntryPermanently('Clients')
      expect(existsSync(join(dir, 'Clients'))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
