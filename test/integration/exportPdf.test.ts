// knote.exportNoteToPdf touches command wiring and webview panel creation —
// runtime behavior the unit suite can't see. Sample.md carries frontmatter and
// a wiki-link, so running the command against it exercises the frontmatter
// strip and the wiki-link resolution path together, not just a bare render.

import * as assert from 'assert'
import * as vscode from 'vscode'
import { activateExtension, closeAllEditors, openNoteAtLine, waitFor } from './helpers'

function exportTab(): vscode.Tab | undefined {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .find(
      (tab) =>
        tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes('exportPdf')
    )
}

describe('knote.exportNoteToPdf', () => {
  before(async () => {
    await activateExtension()
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('is registered', async () => {
    const registered = new Set(await vscode.commands.getCommands(true))
    assert.ok(registered.has('knote.exportNoteToPdf'))
  })

  it('warns instead of opening a panel when no note is active', async () => {
    const original = vscode.window.showWarningMessage
    let warned: string | undefined
    ;(vscode.window as unknown as Record<string, unknown>).showWarningMessage = async (
      message: string
    ) => {
      warned = message
      return undefined
    }
    try {
      await vscode.commands.executeCommand('knote.exportNoteToPdf')
      await waitFor(() => warned !== undefined, { message: 'the warning to fire' })
      assert.ok(warned?.includes('open a vault note'), `unexpected warning: ${warned}`)
      assert.strictEqual(exportTab(), undefined, 'no export panel should have opened')
    } finally {
      vscode.window.showWarningMessage = original
    }
  })

  it('opens a rendered export panel for the active note', async () => {
    await openNoteAtLine('Sample.md', 0)

    await vscode.commands.executeCommand('knote.exportNoteToPdf')

    await waitFor(() => exportTab() !== undefined, { message: 'the export panel tab to open' })
    const tab = exportTab()
    assert.ok(
      tab?.label.includes('Sample'),
      `expected the export tab to name the note, got: ${tab?.label}`
    )
  })
})
