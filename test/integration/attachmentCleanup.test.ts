// Auto attachment cleanup, exercised end-to-end: a real editor edit removes an
// image embed, the save triggers the cleanup, and the image leaves the
// attachments folder (to the OS trash). Also covers the shared-image guard and
// the watcher path (deleting the note file itself from disk).
//
// The later cases cover the harder half: a file is written to disk the moment
// it is pasted, so an embed added and then removed (or abandoned unsaved) never
// appears in two versions of the note's *saved* text. Those leaked before the
// buffer-history tracking in extension/attachmentAutoCleanup.

import * as assert from 'assert'
import { promises as fs } from 'fs'
import * as vscode from 'vscode'
import {
  activateExtension,
  closeAllEditors,
  delay,
  openNoteAtLine,
  vaultUri,
  waitFor,
  writeNoteOnDisk
} from './helpers'

const ATT = 'Knote Resources/Attachments'

async function writeImage(relPath: string): Promise<void> {
  const uri = vaultUri(relPath)
  await fs.mkdir(vscode.Uri.joinPath(uri, '..').fsPath, { recursive: true })
  // A 1x1 PNG — content doesn't matter, only that the file exists on disk.
  await fs.writeFile(uri.fsPath, Buffer.from('89504e470d0a1a0a', 'hex'))
}

async function imageExists(relPath: string): Promise<boolean> {
  try {
    await fs.access(vaultUri(relPath).fsPath)
    return true
  } catch {
    return false
  }
}

/** Delete a whole line from the open editor and save. */
async function deleteLineAndSave(editor: vscode.TextEditor, line: number): Promise<void> {
  await editor.edit((b) => {
    b.delete(editor.document.lineAt(line).rangeIncludingLineBreak)
  })
  await editor.document.save()
}

describe('attachment auto-cleanup', () => {
  before(async () => {
    await activateExtension()
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('trashes an image when its last embed is removed and the note saved', async () => {
    await writeImage(`${ATT}/orphan-me.png`)
    await writeNoteOnDisk('Cleanup A.md', `# Cleanup A\n\n![[${ATT}/orphan-me.png]]\n`)

    const editor = await openNoteAtLine('Cleanup A.md', 2)
    assert.ok(editor.document.lineAt(2).text.includes('orphan-me.png'))
    await deleteLineAndSave(editor, 2)

    await waitFor(async () => !(await imageExists(`${ATT}/orphan-me.png`)), {
      timeout: 10000,
      message: 'orphaned image to be moved to the trash'
    })
  })

  it('keeps an image another note still embeds', async () => {
    await writeImage(`${ATT}/still-shared.png`)
    await writeNoteOnDisk('Cleanup B.md', `# Cleanup B\n\n![[${ATT}/still-shared.png]]\n`)
    await writeNoteOnDisk('Cleanup C.md', `# Cleanup C\n\n![[${ATT}/still-shared.png]]\n`)
    // Let the watcher index Cleanup C so the shared reference is known.
    await delay(1500)

    const editor = await openNoteAtLine('Cleanup B.md', 2)
    await deleteLineAndSave(editor, 2)

    // No positive signal to wait on — give the cleanup ample time to (wrongly)
    // fire, then assert the shared image survived.
    await delay(2500)
    assert.ok(
      await imageExists(`${ATT}/still-shared.png`),
      'an image still embedded elsewhere must never be trashed'
    )
  })

  it('trashes what a note embedded when the note file is deleted on disk', async () => {
    await writeImage(`${ATT}/goes-with-note.png`)
    await writeNoteOnDisk('Cleanup D.md', `# Cleanup D\n\n![[${ATT}/goes-with-note.png]]\n`)
    // Let the watcher pick up and index the new note before deleting it.
    await delay(1500)

    await fs.rm(vaultUri('Cleanup D.md').fsPath)

    await waitFor(async () => !(await imageExists(`${ATT}/goes-with-note.png`)), {
      timeout: 10000,
      message: "the deleted note's orphaned image to be moved to the trash"
    })
  })

  it('trashes an image whose embed was added and removed before any save', async () => {
    await writeImage(`${ATT}/never-saved.png`)
    await writeNoteOnDisk('Cleanup E.md', '# Cleanup E\n\n')

    const editor = await openNoteAtLine('Cleanup E.md', 2)
    await editor.edit((b) => b.insert(new vscode.Position(2, 0), `![[${ATT}/never-saved.png]]\n`))
    await delay(600) // let the change settle into the seen-set
    await deleteLineAndSave(editor, 2)

    await waitFor(async () => !(await imageExists(`${ATT}/never-saved.png`)), {
      timeout: 10000,
      message: 'an image embedded only in an unsaved buffer to be trashed on save'
    })
  })

  it('trashes an image pasted into a note that is closed without saving', async () => {
    await writeImage(`${ATT}/abandoned.png`)
    await writeNoteOnDisk('Cleanup F.md', '# Cleanup F\n\n')

    const editor = await openNoteAtLine('Cleanup F.md', 2)
    await editor.edit((b) => b.insert(new vscode.Position(2, 0), `![[${ATT}/abandoned.png]]\n`))
    await delay(600)
    await closeAllEditors() // reverts the buffer, so disk never held the embed

    // Must outlast CLOSE_SETTLE_MS in extension/attachmentAutoCleanup.
    await waitFor(async () => !(await imageExists(`${ATT}/abandoned.png`)), {
      timeout: 10000,
      message: 'an image abandoned by closing without saving to be trashed'
    })
  })

  it('keeps an image whose embed is removed and re-added before saving', async () => {
    await writeImage(`${ATT}/put-back.png`)
    await writeNoteOnDisk('Cleanup G.md', `# Cleanup G\n\n![[${ATT}/put-back.png]]\n`)

    const editor = await openNoteAtLine('Cleanup G.md', 2)
    await editor.edit((b) => b.delete(editor.document.lineAt(2).rangeIncludingLineBreak))
    await delay(600)
    await editor.edit((b) => b.insert(new vscode.Position(2, 0), `![[${ATT}/put-back.png]]\n`))
    await editor.document.save()

    await delay(2500)
    assert.ok(
      await imageExists(`${ATT}/put-back.png`),
      'cutting an embed and pasting it back before saving must not trash the image'
    )
  })

  it('keeps an image another note embeds even when added and removed unsaved', async () => {
    await writeImage(`${ATT}/shared-unsaved.png`)
    await writeNoteOnDisk('Cleanup H.md', '# Cleanup H\n\n')
    await writeNoteOnDisk('Cleanup I.md', `# Cleanup I\n\n![[${ATT}/shared-unsaved.png]]\n`)
    await delay(1500) // let the watcher index Cleanup I

    const editor = await openNoteAtLine('Cleanup H.md', 2)
    await editor.edit((b) =>
      b.insert(new vscode.Position(2, 0), `![[${ATT}/shared-unsaved.png]]\n`)
    )
    await delay(600)
    await deleteLineAndSave(editor, 2)

    await delay(2500)
    assert.ok(
      await imageExists(`${ATT}/shared-unsaved.png`),
      'an image still embedded elsewhere must survive the unsaved-buffer path too'
    )
  })
})
