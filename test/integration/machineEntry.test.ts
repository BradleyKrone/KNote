// knote.insertMachineEntry is command wiring plus a native prompt (the serial
// input box, since the fixture vault registers no machines) and a buffer edit —
// the runtime path unit tests can't see. It must write the software table the
// Machine Log parses back, not the old free-text template.

import * as assert from 'assert'
import * as vscode from 'vscode'
import {
  activateExtension,
  closeAllEditors,
  openNoteAtLine,
  waitFor,
  writeNoteOnDisk
} from './helpers'

describe('knote.insertMachineEntry', () => {
  before(async () => {
    await activateExtension()
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('inserts a 🚜 entry with the Software / Base / Flashed table', async () => {
    await writeNoteOnDisk('Machine Insert.md', '')
    await openNoteAtLine('Machine Insert.md', 0)

    const originalInputBox = vscode.window.showInputBox
    ;(vscode.window as unknown as Record<string, unknown>).showInputBox = async () => 'Z6A00101'
    try {
      await vscode.commands.executeCommand('knote.insertMachineEntry')

      const text = await waitFor(
        () => {
          const t = vscode.window.activeTextEditor?.document.getText() ?? ''
          return t.includes('🚜 Z6A00101') ? t : undefined
        },
        { message: 'the note buffer to contain the new machine entry' }
      )

      const lines = (text ?? '').split(/\r?\n/)
      assert.match(lines[0], /^🚜 Z6A00101 📅 \d{4}-\d{2}-\d{2} $/)
      assert.deepStrictEqual(lines.slice(1), [
        '| Software  | Base | Flashed |',
        '| --------- | ---- | ------- |',
        '| Implement |      |         |',
        '| EC520     |      |         |',
        '| Machine   |      |         |',
        '| Display   |      |         |',
        '- Notes: '
      ])
    } finally {
      vscode.window.showInputBox = originalInputBox
    }
  })
})
