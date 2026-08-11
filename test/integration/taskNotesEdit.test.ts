// The board's task editor writes a task's line text *and* its attached note
// block in one verified edit. Unit tests cover the splice planning; this proves
// the live-buffer half — a real WorkspaceEdit against an open TextEditor, then
// the auto-save to disk — plus the closed-file disk half. That range arithmetic
// is where a bug strands a blank line, eats a character, or (before this was
// one merged replace) leaves two edits racing for the same offset.

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

const SEED =
  '# Notes\n\n' +
  '- [ ] First task\n' +
  '  - Status Changed: 7/14/2026\n' +
  '  - Date Entered: 7/1/2026\n' +
  '  - Notes: original text\n' +
  '- [ ] Second task\n'

/** Drive the board's save through the uncontributed command the harness can reach. */
async function save(
  note: string,
  line: number,
  expected: string,
  newLine: string,
  body: string[]
): Promise<void> {
  await vscode.commands.executeCommand('knote.setTaskNote', note, line, expected, newLine, body)
}

describe('board task editor: task text + note block in one verified edit', () => {
  before(async () => {
    await activateExtension()
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('rewrites the note body in an open buffer, keeping the managed lines and the sibling task', async () => {
    const NOTE = 'TaskNotesBuffer.md'
    await writeNoteOnDisk(NOTE, SEED)
    const editor = await openNoteAtLine(NOTE, 2)
    assert.strictEqual(editor.document.lineAt(2).text, '- [ ] First task')

    await save(NOTE, 2, '- [ ] First task', '- [ ] First task', ['  - Notes: rewritten'])

    await waitFor(() => editor.document.lineAt(5).text === '  - Notes: rewritten', {
      message: 'the note body to be rewritten in the buffer'
    })
    const text = editor.document.getText()
    assert.ok(text.includes('  - Status Changed: 7/14/2026'), 'Status Changed must survive')
    assert.ok(text.includes('  - Date Entered: 7/1/2026'), 'Date Entered must survive')
    assert.ok(text.includes('- [ ] Second task'), 'the sibling task must be untouched')
    assert.ok(!text.includes('original text'), 'the old body must be gone')

    await waitFor(async () => (await readNoteOnDisk(NOTE)).includes('- Notes: rewritten'), {
      message: 'the rewrite to reach disk'
    })
  })

  it('rewrites the task line and its notes as a single undo step', async () => {
    // The whole reason this is one RPC rather than two: one Ctrl+Z must put
    // the task back exactly as it was, not half of it.
    const NOTE = 'TaskNotesUndo.md'
    await writeNoteOnDisk(NOTE, SEED)
    const editor = await openNoteAtLine(NOTE, 2)
    const before = editor.document.getText()

    await save(NOTE, 2, '- [ ] First task', '- [ ] Renamed task #tag', ['  - Notes: also changed'])

    await waitFor(() => editor.document.lineAt(2).text === '- [ ] Renamed task #tag', {
      message: 'the task line to be rewritten'
    })
    assert.strictEqual(editor.document.lineAt(5).text, '  - Notes: also changed')

    await vscode.commands.executeCommand('undo')
    await waitFor(() => editor.document.getText() === before, {
      message: 'a single undo to restore the note exactly'
    })
  })

  it('adds a note block to a task that had none', async () => {
    const NOTE = 'TaskNotesFresh.md'
    await writeNoteOnDisk(NOTE, '# Fresh\n\n- [ ] Bare task\n- [ ] Next\n')
    const editor = await openNoteAtLine(NOTE, 2)

    await save(NOTE, 2, '- [ ] Bare task', '- [ ] Bare task', ['  - Notes: brand new'])

    await waitFor(() => editor.document.lineAt(3).text === '  - Notes: brand new', {
      message: 'the new note block to appear'
    })
    assert.strictEqual(editor.document.lineAt(4).text, '- [ ] Next')
  })

  it('clears a note block without stranding a blank line', async () => {
    const NOTE = 'TaskNotesCleared.md'
    await writeNoteOnDisk(NOTE, '# Clear\n\n- [ ] Task\n  - Notes: goes away\n- [ ] Next\n')
    const editor = await openNoteAtLine(NOTE, 2)

    await save(NOTE, 2, '- [ ] Task', '- [ ] Task', [])

    await waitFor(() => editor.document.lineAt(3).text === '- [ ] Next', {
      message: 'the note block to be removed with no blank line left behind'
    })
    assert.ok(!editor.document.getText().includes('goes away'))
  })

  it('handles a task on the last line of the file', async () => {
    const NOTE = 'TaskNotesEof.md'
    await writeNoteOnDisk(NOTE, '# Eof\n\n- [ ] Last task\n')
    const editor = await openNoteAtLine(NOTE, 2)

    await save(NOTE, 2, '- [ ] Last task', '- [ ] Last task!', ['  - Notes: at the end'])

    await waitFor(() => editor.document.lineAt(2).text === '- [ ] Last task!', {
      message: 'the trailing task line to be rewritten'
    })
    assert.strictEqual(editor.document.lineAt(3).text, '  - Notes: at the end')
  })

  it('writes straight to disk when the note is not open in an editor', async () => {
    const NOTE = 'TaskNotesClosed.md'
    await writeNoteOnDisk(NOTE, SEED)
    // Never opened, so verifiedEdit takes the core/lineEdit path.
    await save(NOTE, 2, '- [ ] First task', '- [ ] First task', ['  - Notes: written to disk'])

    await waitFor(async () => (await readNoteOnDisk(NOTE)).includes('- Notes: written to disk'), {
      message: 'the disk write to land'
    })
    const onDisk = await readNoteOnDisk(NOTE)
    assert.ok(onDisk.includes('  - Status Changed: 7/14/2026'))
    assert.ok(onDisk.includes('- [ ] Second task'))
  })

  it('keeps a CRLF note on CRLF', async () => {
    const NOTE = 'TaskNotesCrlf.md'
    await writeNoteOnDisk(NOTE, '# CRLF\r\n\r\n- [ ] Task\r\n  - Notes: old\r\n- [ ] Next\r\n')

    await save(NOTE, 2, '- [ ] Task', '- [ ] Task', ['  - Notes: new'])

    await waitFor(async () => (await readNoteOnDisk(NOTE)).includes('- Notes: new'), {
      message: 'the CRLF disk write to land'
    })
    const onDisk = await readNoteOnDisk(NOTE)
    assert.ok(
      !/[^\r]\n/.test(onDisk),
      `every newline must stay CRLF, got ${JSON.stringify(onDisk)}`
    )
  })

  it('refuses a stale write rather than clobbering, leaving the buffer untouched', async () => {
    const NOTE = 'TaskNotesStale.md'
    await writeNoteOnDisk(NOTE, SEED)
    const editor = await openNoteAtLine(NOTE, 2)
    const before = editor.document.getText()

    await assert.rejects(
      () => save(NOTE, 2, '- [ ] A task that is not there', '- [ ] x', ['  - Notes: nope']),
      /KNOTE_STALE/
    )
    assert.strictEqual(editor.document.getText(), before)
  })
})
