// knote.insertVideo touches command wiring, a native open dialog, and a copy
// into the vault — runtime behavior unit tests can't see. The dialog is
// stubbed to hand back a small fixture file from outside the vault.

import * as assert from 'assert'
import * as vscode from 'vscode'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { activateExtension, openNoteAtLine, closeAllEditors, vaultUri, waitFor } from './helpers'

describe('knote.insertVideo', () => {
  before(async () => {
    await activateExtension()
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('copies the picked video into the attachments folder and embeds it in the note', async () => {
    const srcDir = await fs.mkdtemp(join(tmpdir(), 'knote-video-src-'))
    const src = join(srcDir, 'Test Clip.mp4')
    await fs.writeFile(src, 'fake-mp4-bytes')

    await openNoteAtLine('Sample.md', 0)

    const originalOpenDialog = vscode.window.showOpenDialog
    ;(vscode.window as unknown as Record<string, unknown>).showOpenDialog = async () => [
      vscode.Uri.file(src)
    ]

    try {
      await vscode.commands.executeCommand('knote.insertVideo')

      await waitFor(
        () => {
          const text = vscode.window.activeTextEditor?.document.getText() ?? ''
          return text.includes('![[/Knote Resources/Attachments/Test Clip.mp4]]')
        },
        { message: 'the note buffer to contain the new video embed' }
      )

      const bytes = await fs.readFile(vaultUri('Knote Resources/Attachments/Test Clip.mp4').fsPath)
      assert.strictEqual(bytes.toString(), 'fake-mp4-bytes', 'the video is copied byte-for-byte')
      assert.ok(await fs.stat(src), 'the original file is left in place')
    } finally {
      vscode.window.showOpenDialog = originalOpenDialog
      await fs.rm(srcDir, { recursive: true, force: true })
    }
  })

  it('does nothing when the dialog is cancelled', async () => {
    await openNoteAtLine('Sample.md', 0)
    const before = vscode.window.activeTextEditor?.document.getText()

    const originalOpenDialog = vscode.window.showOpenDialog
    ;(vscode.window as unknown as Record<string, unknown>).showOpenDialog = async () => undefined
    try {
      await vscode.commands.executeCommand('knote.insertVideo')
      assert.strictEqual(vscode.window.activeTextEditor?.document.getText(), before)
    } finally {
      vscode.window.showOpenDialog = originalOpenDialog
    }
  })
})
