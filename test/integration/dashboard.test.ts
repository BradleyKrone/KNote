// Covers the Home dashboard's runtime wiring: the `knote.openDashboard`
// command actually opens a webview panel, and the quick-capture plumbing the
// dashboard reuses (captureToWeekNote → this week's note) lands on disk. The
// dashboard's own data selectors are unit-tested in tests/dashboardSelectors;
// here we exercise the parts only a real vscode host can show.

import * as assert from 'assert'
import * as vscode from 'vscode'
import { activateExtension, vaultRoot, waitFor } from './helpers'

describe('Home dashboard', () => {
  before(async () => {
    await activateExtension()
  })

  it('opens a "KNote Home" webview panel', async () => {
    await vscode.commands.executeCommand('knote.openDashboard')
    const openTab = (): boolean =>
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .some((t) => t.label === 'KNote Home' && t.input instanceof vscode.TabInputWebview)
    await waitFor(openTab, { message: 'a KNote Home webview tab to open' })
  })

  it("quick capture appends a timestamped bullet to this week's note", async () => {
    const marker = `dashboard-capture-${Date.now()}`

    // The capture command normally prompts; stub the input box so the shared
    // captureToWeekNote path (also reached by the dashboard's quickCapture RPC)
    // runs headlessly.
    const original = vscode.window.showInputBox
    ;(vscode.window as { showInputBox: unknown }).showInputBox = async () => marker
    try {
      await vscode.commands.executeCommand('knote.quickCapture')
    } finally {
      ;(vscode.window as { showInputBox: unknown }).showInputBox = original
    }

    const weekNoteHasMarker = async (): Promise<boolean> => {
      let entries: [string, vscode.FileType][]
      try {
        entries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(vaultRoot(), 'Weekly'))
      } catch {
        return false
      }
      for (const [name, type] of entries) {
        if (type !== vscode.FileType.File || !name.endsWith('.md')) continue
        const bytes = await vscode.workspace.fs.readFile(
          vscode.Uri.joinPath(vaultRoot(), 'Weekly', name)
        )
        if (Buffer.from(bytes).toString('utf-8').includes(marker)) return true
      }
      return false
    }

    await waitFor(weekNoteHasMarker, {
      message: "this week's note on disk to contain the captured bullet"
    })
  })
})
