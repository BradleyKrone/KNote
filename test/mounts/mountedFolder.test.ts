// The feature itself: a folder that lives nowhere near the vault, opened as a
// second workspace folder, behaves like an ordinary folder inside it.

import * as assert from 'assert'
import * as vscode from 'vscode'
import {
  activateExtension,
  linkResolvesTo,
  closeAllEditors,
  mountName,
  mountUri,
  readMountedOnDisk,
  vaultUri,
  waitFor,
  writeMountedOnDisk
} from './helpers'

const NOTE = 'docs/Mounted Note.md'

/** The vault path a mounted file is known by: "<mount>/docs/Mounted Note.md". */
function mountedPath(rel: string): string {
  return `${mountName()}/${rel}`
}

describe('a folder mounted from outside the vault', () => {
  before(async () => {
    await activateExtension()
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('is indexed, under a path prefixed with the mounted folder’s name', async () => {
    // Reading what a [[wiki link]] resolves to proves the note reached the
    // index, and shows the vault path it was given. Read-only on purpose:
    // *following* an unresolved link would create the note instead.
    await writeMountedOnDisk(NOTE, '# Mounted Note')
    const source = vaultUri('LinksOut.md')
    await vscode.workspace.fs.writeFile(source, Buffer.from('See [[Mounted Note]]', 'utf-8'))

    const expected = mountedPath(NOTE)
    await waitFor(async () => (await linkResolvesTo(source)) === expected, {
      timeout: 15000,
      message: `[[Mounted Note]] to resolve to ${expected}`
    })
  })
  it('accepts a verified edit, which lands on disk inside the mount', async () => {
    await writeMountedOnDisk(NOTE, '# Mounted Note\n\n- [ ] a task in the mounted folder\n')
    const doc = await vscode.workspace.openTextDocument(mountUri(NOTE))
    const editor = await vscode.window.showTextDocument(doc)
    editor.selection = new vscode.Selection(2, 0, 2, 0)

    await vscode.commands.executeCommand('knote.cycleTaskStatus')
    await doc.save()

    const onDisk = await waitFor(
      async () => {
        const text = await readMountedOnDisk(NOTE)
        return text.includes('- [ ] a task') ? null : text
      },
      { message: 'the task status to change on disk' }
    )
    assert.ok(
      !onDisk!.includes('- [ ] a task in the mounted folder'),
      `the task was not rewritten in the mounted folder:\n${onDisk}`
    )
  })

  it('creates new notes inside the mount, not in the vault', async () => {
    const created = mountedPath('docs/Created Here.md')
    await vscode.commands.executeCommand('knote.files.newNote', mountedPath('docs'), 'Created Here')

    await waitFor(
      async () => {
        try {
          await vscode.workspace.fs.stat(mountUri('docs/Created Here.md'))
          return true
        } catch {
          return false
        }
      },
      { message: `${created} to appear inside the mounted folder` }
    )
  })
})
