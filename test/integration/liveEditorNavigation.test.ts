// Every link that navigates to a note — wiki-links in the editor and
// `knote.openNoteAt` (used by the Machines/Milestones quick-access trees) —
// must land in the live-preview custom editor, never the plain text editor.
// This is exactly the kind of command-wiring/runtime behavior unit tests
// can't see: it depends on a real `vscode.window.tabGroups` and the actual
// `vscode.openWith` call landing on `knote.liveEditor`.

import * as assert from 'assert'
import * as vscode from 'vscode'
import { activateExtension, openNoteAtLine, closeAllEditors, waitFor } from './helpers'

function activeCustomViewType(): string | undefined {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab
  const input = tab?.input
  return input instanceof vscode.TabInputCustom ? input.viewType : undefined
}

describe('note-opening commands use the live-preview editor', () => {
  before(async () => {
    await activateExtension()
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('knote.openWikiLink opens an existing target in the live editor', async () => {
    // Open a plain text editor first so we can tell navigation actually moved us.
    await openNoteAtLine('Sample.md', 6)
    assert.strictEqual(activeCustomViewType(), undefined)

    await vscode.commands.executeCommand('knote.openWikiLink', 'Sample')

    await waitFor(() => activeCustomViewType() === 'knote.liveEditor', {
      message: 'active tab to become the live-preview custom editor'
    })
  })

  it('knote.openWikiLink to a #Heading resolves the section line and opens the live editor', async () => {
    await vscode.commands.executeCommand('knote.openWikiLink', 'Sample#Notes')

    await waitFor(() => activeCustomViewType() === 'knote.liveEditor', {
      message: 'active tab to become the live-preview custom editor'
    })
  })

  it('knote.openWikiLink to a #^block-id resolves the block line and opens the live editor', async () => {
    // "Plain text under a heading. ^note-block" in the fixture.
    await vscode.commands.executeCommand('knote.openWikiLink', 'Sample#^note-block')

    await waitFor(() => activeCustomViewType() === 'knote.liveEditor', {
      message: 'active tab to become the live-preview custom editor'
    })
  })

  it('knote.openWikiLink creates a missing target and opens it in the live editor', async () => {
    // "Other Note" is referenced by Sample.md's fixture prose but doesn't exist yet.
    await vscode.commands.executeCommand('knote.openWikiLink', 'Other Note')

    await waitFor(() => activeCustomViewType() === 'knote.liveEditor', {
      message: 'active tab to become the live-preview custom editor'
    })
  })

  it('knote.openNoteAt opens the live editor (Machines/Milestones tree rows)', async () => {
    await vscode.commands.executeCommand('knote.openNoteAt', 'Sample.md', 8)

    await waitFor(() => activeCustomViewType() === 'knote.liveEditor', {
      message: 'active tab to become the live-preview custom editor'
    })
  })
})
