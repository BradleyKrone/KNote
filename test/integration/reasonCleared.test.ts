// Moving a task out of a require-reason column (Waiting) must delete the
// `Reason for Waiting: ... 📅 <date>` line the move *into* that column stamped.
// Unit tests cover the splice; this proves the live-buffer half — a real
// WorkspaceEdit against an open TextEditor, then the auto-save to disk — which
// is the path where a bad range would leave a stray blank line behind.

import * as assert from 'assert'
import {
  activateExtension,
  closeAllEditors,
  openNoteAtLine,
  readNoteOnDisk,
  waitFor,
  writeNoteOnDisk
} from './helpers'
import * as vscode from 'vscode'

const NOTE = 'WaitingReason.md'
const SEED =
  '# Waiting\n\n' +
  '- [w] Waiting task\n' +
  '  Reason for Waiting: vendor quoted 2 weeks 📅 2026-07-01\n' +
  '  - Status Changed: 7/1/2026\n' +
  '  - Notes: keep this line\n'

describe('reason line cleared when a task leaves Waiting', () => {
  before(async () => {
    await activateExtension()
    await writeNoteOnDisk(NOTE, SEED)
  })

  after(async () => {
    await closeAllEditors()
  })

  it('drops the Reason line in the buffer and on disk, keeping the rest of the note', async () => {
    // Line 2 (0-based) is "- [w] Waiting task".
    const editor = await openNoteAtLine(NOTE, 2)
    assert.strictEqual(editor.document.lineAt(2).text, '- [w] Waiting task')

    // Waiting -> In Progress per the fixture column order. Cycling *out* of a
    // require-reason column never prompts, so no showInputBox blocks the test.
    await vscode.commands.executeCommand('knote.cycleTaskStatus')

    await waitFor(() => editor.document.lineAt(2).text === '- [/] Waiting task', {
      message: 'buffer status char to become "/"'
    })
    await waitFor(() => !editor.document.getText().includes('Reason for Waiting:'), {
      message: 'the reason line to be removed from the buffer'
    })

    // No blank line may be left where the reason line was.
    assert.ok(
      editor.document.lineAt(3).text.includes('Status Changed:'),
      `expected the Status Changed line directly under the task, got "${editor.document.lineAt(3).text}"`
    )
    assert.ok(
      editor.document.getText().includes('  - Notes: keep this line'),
      'the rest of the task note must survive the clear'
    )

    // The doc was clean, so the verified edit auto-saves — disk must agree.
    await waitFor(async () => !(await readNoteOnDisk(NOTE)).includes('Reason for Waiting:'), {
      message: 'disk to reflect the removed reason line'
    })
    const onDisk = await readNoteOnDisk(NOTE)
    assert.ok(onDisk.includes('- [/] Waiting task\n  - Status Changed:'), `unexpected note:\n${onDisk}`)
    assert.ok(onDisk.includes('  - Notes: keep this line'), `unexpected note:\n${onDisk}`)
  })
})
