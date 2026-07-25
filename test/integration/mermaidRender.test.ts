// Mermaid fenced code blocks render as diagram widgets in the live-preview
// editor (mermaidRender.ts), but that's presentation-only: opening a note
// containing one must never mutate the underlying Markdown source. This is
// the mechanics a unit test can't see (it needs the real custom editor and
// its two-way sync) — the actual SVG rendering isn't asserted here.

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

const NOTE = 'Mermaid Test.md'
const CONTENT = [
  '# Mermaid Test',
  '',
  'Some prose before the diagram.',
  '',
  '```mermaid',
  'graph TD',
  '  A --> B',
  '```',
  '',
  'Some prose after the diagram.',
  ''
].join('\n')

describe('mermaid fenced code blocks in the live-preview editor', () => {
  before(async () => {
    await activateExtension()
    await writeNoteOnDisk(NOTE, CONTENT)
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('opens a note containing a mermaid block in the live editor without error', async () => {
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
})
