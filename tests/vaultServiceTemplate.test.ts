import { describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as vault from '../src/main/vaultService'

describe('ensureDefaultTemplate', () => {
  it('seeds a starter template note when the templates folder is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-test-'))
    try {
      vault.setVault(dir)
      const created = await vault.ensureDefaultTemplate('Templates')
      expect(created).toBe('Templates/Note Template.md')
      const files = await readdir(join(dir, 'Templates'))
      expect(files).toEqual(['Note Template.md'])
      const content = await readFile(join(dir, 'Templates', 'Note Template.md'), 'utf-8')
      expect(content).toContain('{{title}}')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does nothing if the templates folder already exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-test-'))
    try {
      vault.setVault(dir)
      await vault.createFolder('Templates')
      const created = await vault.ensureDefaultTemplate('Templates')
      expect(created).toBeNull()
      const files = await readdir(join(dir, 'Templates'))
      expect(files).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
