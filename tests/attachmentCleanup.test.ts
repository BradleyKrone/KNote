import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as vault from '../src/core/vaultService'
import * as vaultIndex from '../src/core/indexer/vaultIndex'
import {
  cleanupAttachmentsForDeletedNote,
  cleanupRemovedAttachments,
  cleanupUnreferenced,
  imageRefsOf
} from '../src/core/attachmentCleanup'
import { allAttachmentFolders, attachmentsFolderFor } from '../src/core/attachments'
import { setVaultConfig } from '../src/core/vaultConfig'
import { DEFAULT_VAULT_CONFIG } from '../src/shared/types'

const ATT = 'Knote Resources/Attachments'

describe('attachment auto-cleanup', () => {
  let dir: string
  let trashed: string[]

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'knote-att-'))
    vault.setVault(dir)
    // Empty vault on disk — the index is seeded in-memory per test.
    await vaultIndex.initIndex()
    trashed = []
    vault.setTrashHandler(async (abs) => {
      trashed.push(abs.replace(dir, '').replace(/\\/g, '/').replace(/^\//, ''))
    })
  })

  afterEach(async () => {
    await vaultIndex.initIndex() // re-scan the now-deleted dir → clears the singleton index
    await rm(dir, { recursive: true, force: true })
  })

  it('trashes an attachment when its last embed is removed', async () => {
    const oldContent = `Some text\n![[${ATT}/img.png]]\n`
    vaultIndex.updateFromContent('Note.md', oldContent)
    await cleanupRemovedAttachments('Note.md', oldContent, 'Some text\n')
    expect(trashed).toEqual([`${ATT}/img.png`])
  })

  it('keeps an attachment another note still embeds', async () => {
    const oldContent = `![[${ATT}/shared.png]]\n`
    vaultIndex.updateFromContent('A.md', oldContent)
    vaultIndex.updateFromContent('B.md', `Also uses ![[${ATT}/shared.png]]\n`)
    await cleanupRemovedAttachments('A.md', oldContent, 'embed gone\n')
    expect(trashed).toEqual([])
  })

  it('keeps an attachment the new content still references', async () => {
    const oldContent = `![[${ATT}/img.png]] before\n`
    vaultIndex.updateFromContent('Note.md', oldContent)
    await cleanupRemovedAttachments('Note.md', oldContent, `after ![[${ATT}/img.png]]\n`)
    expect(trashed).toEqual([])
  })

  it('never touches images outside the attachments folder', async () => {
    const oldContent = '![[Elsewhere/photo.png]]\n'
    vaultIndex.updateFromContent('Note.md', oldContent)
    await cleanupRemovedAttachments('Note.md', oldContent, '\n')
    expect(trashed).toEqual([])
  })

  it('detects markdown-style image references too', async () => {
    const oldContent = `![alt](${ATT.replace(/ /g, '%20')}/pic.png)\n`
    vaultIndex.updateFromContent('Note.md', oldContent)
    await cleanupRemovedAttachments('Note.md', oldContent, 'no image\n')
    expect(trashed).toEqual([`${ATT}/pic.png`])
  })

  it('a markdown-style reference in another note protects a wiki-embedded image', async () => {
    const oldContent = `![[${ATT}/shared.png]]\n`
    vaultIndex.updateFromContent('A.md', oldContent)
    vaultIndex.updateFromContent('B.md', `![alt](${ATT.replace(/ /g, '%20')}/shared.png)\n`)
    await cleanupRemovedAttachments('A.md', oldContent, '\n')
    expect(trashed).toEqual([])
  })

  it('does nothing without a baseline (oldContent undefined)', async () => {
    await cleanupRemovedAttachments('Note.md', undefined, 'anything\n')
    expect(trashed).toEqual([])
  })

  it('trashes everything a deleted note embedded, unless shared', async () => {
    const content = `![[${ATT}/only-mine.png]]\n![[${ATT}/shared.png]]\n`
    vaultIndex.updateFromContent('Gone.md', content)
    vaultIndex.updateFromContent('Stays.md', `![[${ATT}/shared.png]]\n`)
    // Simulate the deletion: the index no longer holds the note.
    await vaultIndex.handleFsChange('Gone.md', 'unlink')
    await cleanupAttachmentsForDeletedNote('Gone.md', content)
    expect(trashed).toEqual([`${ATT}/only-mine.png`])
  })

  it('embeds resolve relative to the note folder', async () => {
    // A note inside the attachments folder's parent referencing by relative path
    const oldContent = '![[Attachments/img.png]]\n'
    vaultIndex.updateFromContent('Knote Resources/Note.md', oldContent)
    await cleanupRemovedAttachments('Knote Resources/Note.md', oldContent, '\n')
    expect(trashed).toEqual([`${ATT}/img.png`])
  })

  it('reports what a deleted note cleanup trashed', async () => {
    const content = `![[${ATT}/reported.png]]\n`
    vaultIndex.updateFromContent('Gone.md', content)
    await vaultIndex.handleFsChange('Gone.md', 'unlink')
    const result = await cleanupAttachmentsForDeletedNote('Gone.md', content)
    expect(result.trashed).toEqual([`${ATT}/reported.png`])
    expect(result.failed).toEqual([])
  })
})

describe('imageRefsOf', () => {
  it('collects wiki embeds and markdown images, skipping non-images and remote URLs', () => {
    const content = [
      `![[${ATT}/wiki.png]]`,
      `![alt](${ATT.replace(/ /g, '%20')}/markdown.jpg)`,
      '![[Some Note]]', // an embed, but not an image
      '[[Knote Resources/Attachments/linked.png]]', // a link, not an embed
      '![remote](https://example.com/nope.png)',
      `![doc](${ATT}/manual.pdf)`
    ].join('\n')
    expect(imageRefsOf(content, 'Note.md')).toEqual([`${ATT}/wiki.png`, `${ATT}/markdown.jpg`])
  })
})

// The bug this API exists for: an attachment is written to disk the moment it is
// pasted, so a ref that only ever lived in an unsaved buffer never appears in
// any two versions of the note's saved text. Candidates come from the buffer's
// history instead — see extension/attachmentAutoCleanup.
describe('cleanupUnreferenced', () => {
  let dir: string
  let trashed: string[]

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'knote-att-'))
    vault.setVault(dir)
    await vaultIndex.initIndex()
    trashed = []
    vault.setTrashHandler(async (abs) => {
      trashed.push(abs.replace(dir, '').replace(/\\/g, '/').replace(/^\//, ''))
    })
  })

  afterEach(async () => {
    await vaultIndex.initIndex()
    await rm(dir, { recursive: true, force: true })
  })

  it('trashes a candidate the new content never contained', async () => {
    vaultIndex.updateFromContent('Note.md', 'no embed\n')
    const result = await cleanupUnreferenced('Note.md', [`${ATT}/pasted.png`], 'no embed\n')
    expect(trashed).toEqual([`${ATT}/pasted.png`])
    expect(result.trashed).toEqual([`${ATT}/pasted.png`])
  })

  it('keeps a candidate the new content still references', async () => {
    const text = `kept ![[${ATT}/pasted.png]]\n`
    vaultIndex.updateFromContent('Note.md', text)
    await cleanupUnreferenced('Note.md', [`${ATT}/pasted.png`], text)
    expect(trashed).toEqual([])
  })

  it('keeps a candidate another note still embeds', async () => {
    vaultIndex.updateFromContent('A.md', 'gone\n')
    vaultIndex.updateFromContent('B.md', `![[${ATT}/shared.png]]\n`)
    await cleanupUnreferenced('A.md', [`${ATT}/shared.png`], 'gone\n')
    expect(trashed).toEqual([])
  })

  it('ignores candidates outside the attachments folder', async () => {
    vaultIndex.updateFromContent('Note.md', '\n')
    await cleanupUnreferenced('Note.md', ['Elsewhere/photo.png'], '\n')
    expect(trashed).toEqual([])
  })

  it('trashes a duplicated candidate exactly once', async () => {
    vaultIndex.updateFromContent('Note.md', '\n')
    const dupes = [`${ATT}/twice.png`, `${ATT}/twice.png`, `${ATT}/Twice.PNG`]
    const result = await cleanupUnreferenced('Note.md', dupes, '\n')
    expect(trashed).toEqual([`${ATT}/twice.png`])
    expect(result.trashed).toHaveLength(1)
    expect(result.failed).toEqual([])
  })

  it('reports a failing trash handler instead of swallowing it', async () => {
    // What an untrashable file on OneDrive looks like: workspace.fs.delete
    // rejects, and the user used to get no signal at all.
    vault.setTrashHandler(async () => {
      throw new Error('EPERM: operation not permitted')
    })
    vaultIndex.updateFromContent('Note.md', '\n')
    const result = await cleanupUnreferenced('Note.md', [`${ATT}/locked.png`], '\n')
    expect(result.trashed).toEqual([])
    expect(result.failed).toEqual([
      { path: `${ATT}/locked.png`, error: 'EPERM: operation not permitted' }
    ])
  })

  it('is a no-op with no candidates', async () => {
    vaultIndex.updateFromContent('Note.md', `![[${ATT}/img.png]]\n`)
    const result = await cleanupUnreferenced('Note.md', [], '\n')
    expect(trashed).toEqual([])
    expect(result.trashed).toEqual([])
  })
})

describe('attachments in a vault that spans folders', () => {
  it('keeps a mounted note’s attachments inside that mount', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-att-mount-'))
    const mount = await mkdtemp(join(tmpdir(), 'knote-att-repo-'))
    try {
      vault.setVault(dir)
      vault.setMounts([{ name: 'repo', root: mount }])
      // A note inside a git repo has to keep its image in the repo, or the
      // committed markdown points at a file the repo has never heard of.
      expect(await attachmentsFolderFor('repo/docs/Post.md')).toBe(
        'repo/Knote Resources/Attachments'
      )
      expect(await attachmentsFolderFor('Weekly/2026-1-1.md')).toBe('Knote Resources/Attachments')
      expect(await allAttachmentFolders()).toEqual([
        'Knote Resources/Attachments',
        'repo/Knote Resources/Attachments'
      ])
    } finally {
      vault.setMounts([])
      await rm(dir, { recursive: true, force: true })
      await rm(mount, { recursive: true, force: true })
    }
  })

  it('never trashes a file inside a mount that is not an attachment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-att-mount2-'))
    const mount = await mkdtemp(join(tmpdir(), 'knote-att-repo2-'))
    try {
      vault.setVault(dir)
      vault.setMounts([{ name: 'repo', root: mount }])
      await mkdir(join(mount, 'assets'), { recursive: true })
      await writeFile(join(mount, 'assets', 'logo.png'), 'x')

      // The note dropped its reference, but the image lives in the repo's own
      // assets folder — outside every attachments folder, so hands off.
      const result = await cleanupUnreferenced(
        'repo/Post.md',
        ['repo/assets/logo.png'],
        'no images now'
      )

      expect(result.trashed).toEqual([])
      expect(existsSync(join(mount, 'assets', 'logo.png'))).toBe(true)
    } finally {
      vault.setMounts([])
      await rm(dir, { recursive: true, force: true })
      await rm(mount, { recursive: true, force: true })
    }
  })

  it('refuses to sweep anything when the attachments folder is the vault root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knote-att-root-'))
    try {
      vault.setVault(dir)
      // isInside(rel, '') is true for everything, so an empty attachments
      // folder would otherwise make every dropped image ref a deletion.
      await setVaultConfig({ ...DEFAULT_VAULT_CONFIG, attachmentsFolder: '' })
      await writeFile(join(dir, 'anywhere.png'), 'x')

      const result = await cleanupUnreferenced('Note.md', ['anywhere.png'], 'no images now')

      expect(result.trashed).toEqual([])
      expect(existsSync(join(dir, 'anywhere.png'))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
