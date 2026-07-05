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

  it('seeded starter template is not itself stamped with a created date', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-test-'))
    try {
      vault.setVault(dir)
      await vault.ensureDefaultTemplate('Templates')
      const content = await readFile(join(dir, 'Templates', 'Note Template.md'), 'utf-8')
      expect(content).not.toContain('created:')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('stampCreatedFrontmatter', () => {
  it('prepends a frontmatter block with a created date to plain content', () => {
    const result = vault.stampCreatedFrontmatter('# Hello\n')
    expect(result).toMatch(/^---\ncreated: \d{4}-\d{2}-\d{2}T.*\n---\n# Hello\n$/)
  })

  it('injects created into an existing frontmatter block without one', () => {
    const result = vault.stampCreatedFrontmatter('---\ntags:\n  - foo\n---\nBody')
    expect(result).toMatch(/^---\ncreated: .*\ntags:\n {2}- foo\n---\nBody$/)
  })

  it('does not overwrite an existing created value', () => {
    const original = '---\ncreated: 2020-01-01T00:00:00.000Z\n---\nBody'
    expect(vault.stampCreatedFrontmatter(original)).toBe(original)
  })

  it('leaves malformed frontmatter untouched', () => {
    const original = '---\n: : not yaml\n---\nBody'
    expect(vault.stampCreatedFrontmatter(original)).toBe(original)
  })
})

describe('createFile created-date stamping', () => {
  it('stamps a new markdown note with a created date', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-test-'))
    try {
      vault.setVault(dir)
      await vault.createFile('Note.md', '# Hello\n')
      const content = await readFile(join(dir, 'Note.md'), 'utf-8')
      expect(content).toMatch(/^---\ncreated: /)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('skips stamping when skipCreatedStamp is set', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-test-'))
    try {
      vault.setVault(dir)
      await vault.createFile('Note.md', '# Hello\n', { skipCreatedStamp: true })
      const content = await readFile(join(dir, 'Note.md'), 'utf-8')
      expect(content).toBe('# Hello\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
