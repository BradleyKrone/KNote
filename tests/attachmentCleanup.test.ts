import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as vault from '../src/core/vaultService'
import * as vaultIndex from '../src/core/indexer/vaultIndex'
import {
  cleanupAttachmentsForDeletedNote,
  cleanupRemovedAttachments
} from '../src/core/attachmentCleanup'

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
})
