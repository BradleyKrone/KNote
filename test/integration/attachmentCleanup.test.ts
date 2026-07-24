// Auto attachment cleanup, exercised end-to-end: a real editor edit removes an
// image embed, the save triggers the cleanup, and the image leaves the
// attachments folder (to the OS trash). Also covers the shared-image guard and
// the watcher path (deleting the note file itself from disk).

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
})
