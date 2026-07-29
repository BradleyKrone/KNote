// Pipe tables render as real <table> widgets in the live-preview editor
// (tableRender.ts), and their cells are edited in place (tableCellEdit.ts) —
// but all of that is presentation: opening a note containing a table must
// never mutate the underlying Markdown source, LF or CRLF. That's the
// mechanics a unit test can't see (it needs the real custom editor and its
// two-way sync).
//
// Everything else about tables splits along this repo's usual lines: the
// position/parse logic is unit-tested (tests/tableModel.test.ts,
// tests/tableCellLogic.test.ts), the state machine that decides rendered vs
// raw and where the caret may land is unit-tested against a real EditorState
// (tests/tableCellEdit.test.ts), and the DOM interaction — which the harness
// can't drive, since it can't type into a webview — is verified by hand in the
// F5 dev host against this checklist:
//
//   - click a cell, type; the grid stays rendered and the text lands
//   - Tab through every cell; Tab off the last cell appends a row
//   - Enter moves down and appends on the last row; Shift+Enter breaks a line
//   - Escape leaves the table; arrow keys cross cells only from a cell's edge
//   - `[[` and `#` autocomplete pop up inside a cell, unclipped by the grid
//   - Ctrl+Z reaches VS Code
//   - paste a block copied from Excel; the table grows to fit
//   - right-click the last cell of the last row: under Table ▸, Insert row
//     above/below, Delete row and the column ops all act on *that* row and
//     column, not the header/first column — with and without a cell already
//     open elsewhere in the table, and the same again in Edit table source view
//   - right-click a cell in the second of two tables in one note; the first
//     table is left alone
//   - right-click a cell without opening it for editing (the menu is all a
//     right-click does)
//   - right-click Table ▸ Edit table source, then click away
//   - scroll a focused cell out of the viewport and back
//   - find/replace hitting text inside a table reveals its source

import * as assert from 'assert'
import * as vscode from 'vscode'
import {
  activateExtension,
  closeAllEditors,
  readNoteOnDisk,
  vaultUri,
  waitFor,
  writeNoteOnDisk
} from './helpers'

function activeCustomViewType(): string | undefined {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab
  const input = tab?.input
  return input instanceof vscode.TabInputCustom ? input.viewType : undefined
}

const NOTE = 'Table Test.md'
const CONTENT = [
  '# Table Test',
  '',
  'Some prose before the table.',
  '',
  '| Name | Qty |',
  '| ---- | --: |',
  '| Bolt | 12  |',
  '| Nut  | 3   |',
  '',
  'Some prose after the table.',
  ''
].join('\n')

const CRLF_NOTE = 'Table Test CRLF.md'
const CRLF_CONTENT = CONTENT.replace(/\n/g, '\r\n')

describe('pipe tables in the live-preview editor', () => {
  before(async () => {
    await activateExtension()
    await writeNoteOnDisk(NOTE, CONTENT)
    await writeNoteOnDisk(CRLF_NOTE, CRLF_CONTENT)
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('opens a note containing a table in the live editor without error', async () => {
    await vscode.commands.executeCommand('knote.openLivePreview', vaultUri(NOTE))

    await waitFor(() => activeCustomViewType() === 'knote.liveEditor', {
      message: 'active tab to become the live-preview custom editor'
    })
  })

  it('leaves the note byte-identical on disk after opening', async () => {
    await vscode.commands.executeCommand('knote.openLivePreview', vaultUri(NOTE))
    await waitFor(() => activeCustomViewType() === 'knote.liveEditor', {
      message: 'active tab to become the live-preview custom editor'
    })

    // Give the webview a moment to fully init and round-trip through
    // editorSync before asserting nothing on disk moved.
    await waitFor(async () => (await readNoteOnDisk(NOTE)) === CONTENT, {
      message: 'on-disk content to remain byte-identical to the fixture'
    })
    assert.strictEqual(await readNoteOnDisk(NOTE), CONTENT)
  })

  it('leaves a CRLF note containing a table byte-identical on disk', async () => {
    // The editor holds the document in LF and translates back on write, so a
    // table in a CRLF note is where a stray offset-based edit would show up
    // first — as characters dropped one per preceding line.
    await vscode.commands.executeCommand('knote.openLivePreview', vaultUri(CRLF_NOTE))
    await waitFor(() => activeCustomViewType() === 'knote.liveEditor', {
      message: 'active tab to become the live-preview custom editor'
    })

    await waitFor(async () => (await readNoteOnDisk(CRLF_NOTE)) === CRLF_CONTENT, {
      message: 'CRLF content to remain byte-identical to the fixture'
    })
    assert.strictEqual(await readNoteOnDisk(CRLF_NOTE), CRLF_CONTENT)
  })
})
