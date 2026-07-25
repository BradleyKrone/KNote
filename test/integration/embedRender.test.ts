// `![[Note]]` transclusion renders as a card in the live-preview editor
// (embedRender.ts). Like the mermaid case, that's presentation-only: opening a
// note full of embeds — including unresolved ones — must never mutate the
// Markdown source, and must not break the editor.
//
// The card's DOM lives inside the webview and isn't reachable from here; the
// slicing, rendering and line-detection logic is unit-tested instead (see
// tests/embedSlice, tests/renderMarkdown, tests/embedLogic).

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

const TARGET = 'Embed Target.md'
const TARGET_CONTENT = [
  '# Embed Target',
  '',
  'intro prose',
  '',
  '## Section One',
  '',
  'section one body',
  '',
  '- [ ] a task ^task1',
  '  - Notes: task detail',
  '',
  '## Section Two',
  '',
  'section two body',
  ''
].join('\n')

const HOST = 'Embed Host.md'
const HOST_CONTENT = [
  '# Embed Host',
  '',
  'A whole-note embed:',
  '',
  '![[Embed Target]]',
  '',
  'A heading section:',
  '',
  '![[Embed Target#Section One]]',
  '',
  'A block reference:',
  '',
  '![[Embed Target#^task1]]',
  '',
  'An unresolved one:',
  '',
  '![[Nothing Here At All]]',
  '',
  'And one mid-sentence: ![[Embed Target]] which stays inline.',
  ''
].join('\n')

async function openLivePreview(note: string): Promise<void> {
  await vscode.commands.executeCommand('knote.openLivePreview', vaultUri(note))
  await waitFor(() => activeCustomViewType() === 'knote.liveEditor', {
    message: 'active tab to become the live-preview custom editor'
  })
}

describe('note embeds in the live-preview editor', () => {
  before(async () => {
    await activateExtension()
    await writeNoteOnDisk(TARGET, TARGET_CONTENT)
    await writeNoteOnDisk(HOST, HOST_CONTENT)
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('opens a note full of embeds in the live editor without error', async () => {
    await openLivePreview(HOST)
  })

  it('leaves the embedding note byte-identical on disk', async () => {
    await openLivePreview(HOST)
    await waitFor(async () => (await readNoteOnDisk(HOST)) === HOST_CONTENT, {
      message: 'on-disk content to remain byte-identical to the fixture'
    })
    assert.strictEqual(await readNoteOnDisk(HOST), HOST_CONTENT)
  })

  it('leaves the embedded note byte-identical on disk', async () => {
    await openLivePreview(HOST)
    await waitFor(async () => (await readNoteOnDisk(TARGET)) === TARGET_CONTENT, {
      message: 'embedded note to remain byte-identical'
    })
    assert.strictEqual(await readNoteOnDisk(TARGET), TARGET_CONTENT)
  })
})
