// A note with Windows line endings must survive a verified edit byte-for-byte:
// only the targeted line changes, every CRLF stays a CRLF, and no stray LF is
// introduced. This is the disk half of the CRLF corruption fix — the CodeMirror
// half can't be driven from here (the harness can't type into a webview) and is
// covered by tests/editorSyncCrlf.test.ts.

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

const CRLF = '\r\n'
const NOTE = 'CrlfNote.md'

// Several lines, with the task well down the file: an offset that drifts by one
// per preceding line only shows up clearly below the first couple of lines.
const LINES = [
  '# CRLF note',
  '',
  '## Propose 2D Features',
  '',
  '- Blade Monitor',
  '- Stable Bucket',
  '- Steer Assist',
  '',
  '- [ ] First task',
  '',
  'Trailing prose that must not move.'
]

describe('notes with CRLF line endings', () => {
  before(async () => {
    await activateExtension()
    await writeNoteOnDisk(NOTE, LINES.join(CRLF))
  })

  after(async () => {
    await closeAllEditors()
  })

  it('keeps CRLF endings and only touches the edited line', async () => {
    const editor = await openNoteAtLine(NOTE, 8)
    assert.strictEqual(
      editor.document.eol,
      vscode.EndOfLine.CRLF,
      'the fixture must load as a CRLF document for this test to mean anything'
    )
    assert.strictEqual(editor.document.lineAt(8).text, '- [ ] First task')

    await vscode.commands.executeCommand('knote.cycleTaskStatus')

    await waitFor(() => editor.document.lineAt(8).text.startsWith('- [r] First task'), {
      message: 'buffer status char to become "r"'
    })
    await waitFor(async () => (await readNoteOnDisk(NOTE)).includes('- [r] First task'), {
      message: 'disk to reflect the "r" status'
    })

    const onDisk = await readNoteOnDisk(NOTE)

    // No bare LF anywhere — a mixed-EOL write is exactly the corruption
    // signature we're guarding against.
    assert.ok(
      !/(^|[^\r])\n/.test(onDisk),
      `every line ending must still be CRLF, got: ${JSON.stringify(onDisk)}`
    )

    // Cycling a status also stamps a "Status Changed" meta line under the task,
    // so the note gains a line — but every original line other than the task
    // itself must still be present, byte-identical and in order. Dropped or
    // shifted characters (the corruption signature) break this.
    const after = onDisk.split(CRLF)
    const untouched = LINES.filter((_, i) => i !== 8)
    let cursor = 0
    for (const expected of untouched) {
      const found = after.indexOf(expected, cursor)
      assert.notStrictEqual(
        found,
        -1,
        `line ${JSON.stringify(expected)} must survive intact, got: ${JSON.stringify(after)}`
      )
      cursor = found + 1
    }
    assert.ok(
      after.some((l) => l.startsWith('- [r] First task')),
      `the task line must be updated, got: ${JSON.stringify(after)}`
    )
    assert.ok(
      !after.some((l) => l.startsWith('- [ ] First task')),
      'the old task line should be gone'
    )
  })
})
