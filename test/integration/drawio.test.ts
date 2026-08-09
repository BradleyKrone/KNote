// knote.insertDrawioDiagram touches command wiring, disk writes and a native
// dialog prompt — exactly the runtime behavior unit tests can't see. The
// Draw.io Integration extension is never installed in this harness, so this
// also exercises the graceful "not installed" path openDrawioUri falls back
// to instead of throwing.

import * as assert from 'assert'
import * as vscode from 'vscode'
import { promises as fs } from 'fs'
import { activateExtension, openNoteAtLine, closeAllEditors, vaultUri, waitFor } from './helpers'

describe('knote.insertDrawioDiagram', () => {
  before(async () => {
    await activateExtension()
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('creates an empty .drawio.svg attachment, embeds it in the note, and prompts to install Draw.io when absent', async () => {
    await openNoteAtLine('Sample.md', 0)

    const originalInputBox = vscode.window.showInputBox
    const originalWarning = vscode.window.showWarningMessage
    let warned: string | undefined
    ;(vscode.window as unknown as Record<string, unknown>).showInputBox = async () =>
      'Test Diagram'
    ;(vscode.window as unknown as Record<string, unknown>).showWarningMessage = async (
      message: string
    ) => {
      warned = message
      return undefined // user dismisses the "Search Marketplace" action
    }

    try {
      await vscode.commands.executeCommand('knote.insertDrawioDiagram')

      await waitFor(
        () => {
          const text = vscode.window.activeTextEditor?.document.getText() ?? ''
          return text.includes('![[/Knote Resources/Attachments/Test Diagram.drawio.svg]]')
        },
        { message: 'the note buffer to contain the new diagram embed' }
      )

      const bytes = await fs.readFile(
        vaultUri('Knote Resources/Attachments/Test Diagram.drawio.svg').fsPath
      )
      assert.strictEqual(bytes.length, 0, 'a fresh diagram is written empty, like a blank canvas')

      await waitFor(() => warned !== undefined, { message: 'the install-prompt warning to fire' })
      assert.ok(
        warned?.toLowerCase().includes('draw.io'),
        `expected an install prompt mentioning draw.io, got: ${warned}`
      )
    } finally {
      vscode.window.showInputBox = originalInputBox
      vscode.window.showWarningMessage = originalWarning
    }
  })
})
