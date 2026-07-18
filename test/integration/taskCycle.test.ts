// Drives `knote.cycleTaskStatus` the way a keypress would (Ctrl+L on a task
// line) and asserts the verified edit lands in BOTH the live buffer and on
// disk. This is exactly the runtime path that unit tests can't reach: a real
// TextEditor, a real WorkspaceEdit + save, the real config-driven column order.

import * as assert from 'assert'
import {
  activateExtension,
  openNoteAtLine,
  readNoteOnDisk,
  waitFor
} from './helpers'
import * as vscode from 'vscode'

describe('knote.cycleTaskStatus', () => {
  before(async () => {
    await activateExtension()
  })

  it('advances a To Do task to the next column char and persists it', async () => {
    // Sample.md line 8 (0-based) is "- [ ] First task".
    const editor = await openNoteAtLine('Sample.md', 8)
    assert.strictEqual(editor.document.lineAt(8).text, '- [ ] First task')

    await vscode.commands.executeCommand('knote.cycleTaskStatus')

    // To Do (' ') -> Ready to Work ('r') per the fixture's column config.
    await waitFor(() => editor.document.lineAt(8).text.startsWith('- [r] First task'), {
      message: 'buffer status char to become "r"'
    })

    // The doc was clean, so the verified edit auto-saves — disk must agree.
    await waitFor(async () => (await readNoteOnDisk('Sample.md')).includes('- [r] First task'), {
      message: 'disk to reflect the "r" status'
    })
    const onDisk = await readNoteOnDisk('Sample.md')
    assert.ok(
      !onDisk.includes('- [ ] First task'),
      'the old "- [ ] First task" line should be gone from disk'
    )
  })

  it('does nothing when the cursor is not on a task line', async () => {
    // Line 4 is the "# Sample note" heading — not a task.
    const editor = await openNoteAtLine('Sample.md', 4)
    const before = editor.document.getText()
    await vscode.commands.executeCommand('knote.cycleTaskStatus')
    assert.strictEqual(editor.document.getText(), before, 'a non-task line must be left untouched')
  })
})
