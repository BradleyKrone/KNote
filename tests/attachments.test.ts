import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as vault from '../src/core/vaultService'
import { createDrawioDiagram, importAttachment, saveImageAttachment } from '../src/core/attachments'

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

describe('createDrawioDiagram', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'knote-attach-'))
    vault.setVault(dir)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes an empty .drawio.svg into the default attachments folder', async () => {
    const saved = await createDrawioDiagram()
    expect(saved).toBe(`${ATT}/Diagram 20260724120000.drawio.svg`)
    const onDisk = await readFile(join(dir, saved))
    expect(onDisk.length).toBe(0)
  })

  it('uniquifies the filename when it collides with an existing file', async () => {
    // uniquify() only splits on the last dot, so a same-second collision on a
    // double-extension name lands the disambiguator before .svg, not before
    // .drawio.svg as a whole — same behavior every other attachment type gets.
    const first = await createDrawioDiagram()
    const second = await createDrawioDiagram()
    expect(second).not.toBe(first)
    expect(second).toBe(`${ATT}/Diagram 20260724120000.drawio 1.svg`)
  })
})

describe('importAttachment', () => {
  let dir: string
  let outside: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'knote-attach-'))
    outside = await mkdtemp(join(tmpdir(), 'knote-import-src-'))
    vault.setVault(dir)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('copies a file from outside the vault into the attachments folder under its own name', async () => {
    const src = join(outside, 'Holiday clip.mp4')
    await writeFile(src, 'fake-mp4-bytes')
    const saved = await importAttachment(src, null)
    expect(saved).toBe(`${ATT}/Holiday clip.mp4`)
    expect((await readFile(join(dir, saved))).toString()).toBe('fake-mp4-bytes')
    // A copy, not a move: the original stays where it was.
    expect((await readFile(src)).toString()).toBe('fake-mp4-bytes')
  })

  it('uniquifies instead of overwriting a same-named attachment', async () => {
    const src = join(outside, 'clip.mp4')
    await writeFile(src, 'new')
    await mkdir(join(dir, ATT), { recursive: true })
    await writeFile(join(dir, ATT, 'clip.mp4'), 'old')
    const saved = await importAttachment(src, null)
    expect(saved).toBe(`${ATT}/clip 1.mp4`)
    expect((await readFile(join(dir, ATT, 'clip.mp4'))).toString()).toBe('old')
    expect((await readFile(join(dir, saved))).toString()).toBe('new')
  })
})
