import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as vault from '../src/core/vaultService'
import { saveImageAttachment } from '../src/core/attachments'

vi.mock('dayjs', () => {
  const fixed = () => ({ format: () => '20260724120000' })
  return { default: fixed }
})

const ATT = 'Knote Resources/Attachments'

describe('saveImageAttachment', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'knote-attach-'))
    vault.setVault(dir)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes the bytes into the default attachments folder with a mime-mapped extension', async () => {
    const saved = await saveImageAttachment('image/png', Buffer.from('fake-png-bytes'))
    expect(saved).toBe(`${ATT}/Pasted image 20260724120000.png`)
    const onDisk = await readFile(join(dir, saved))
    expect(onDisk.toString()).toBe('fake-png-bytes')
  })

  it('maps jpeg/gif/webp/bmp/svg mimes to the right extension', async () => {
    expect(await saveImageAttachment('image/jpeg', Buffer.from('a'))).toMatch(/\.jpg$/)
    expect(await saveImageAttachment('image/svg+xml', Buffer.from('a'))).toMatch(/\.svg$/)
  })

  it('falls back to .png for an unrecognized mime type', async () => {
    const saved = await saveImageAttachment('image/heic', Buffer.from('a'))
    expect(saved).toMatch(/\.png$/)
  })

  it('uniquifies the filename when it collides with an existing file', async () => {
    const first = await saveImageAttachment('image/png', Buffer.from('one'))
    const second = await saveImageAttachment('image/png', Buffer.from('two'))
    expect(second).not.toBe(first)
    expect(second).toBe(`${ATT}/Pasted image 20260724120000 1.png`)
  })

  it('respects a custom attachmentsFolder from vault config', async () => {
    await mkdir(join(dir, '.knote'), { recursive: true })
    await writeFile(
      join(dir, '.knote', 'config.json'),
      JSON.stringify({ attachmentsFolder: 'Media' }),
      'utf-8'
    )
    const saved = await saveImageAttachment('image/png', Buffer.from('x'))
    expect(saved).toBe('Media/Pasted image 20260724120000.png')
  })
})
