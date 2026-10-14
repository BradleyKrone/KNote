// The Kanban board panel's open/reveal lifecycle, black-box: opening twice
// reveals the one board rather than stacking a second tab, and a board that was
// closed opens again on the next run — the path the Kanban activity-bar icon
// drives, which once got stuck on a dead panel until VS Code was restarted.

import * as assert from 'assert'
import * as vscode from 'vscode'
import { activateExtension, closeAllEditors, waitFor } from './helpers'

function boardTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter(
      (t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith('knote.board')
    )
}

describe('board panel', () => {
  before(async () => {
    await activateExtension()
  })

  after(async () => {
    await closeAllEditors()
  })

  it('opens a single board, revealing it on a second run', async () => {
    await closeAllEditors()
    await vscode.commands.executeCommand('knote.openBoard')
    await waitFor(() => boardTabs().length === 1, { message: 'the board tab to open' })
    await vscode.commands.executeCommand('knote.openBoard')
    assert.strictEqual(boardTabs().length, 1)
    assert.strictEqual(boardTabs()[0].label, 'KNote Board')
  })

  it('reopens the board after its tab was closed', async () => {
    await closeAllEditors()
    await vscode.commands.executeCommand('knote.openBoard')
    await waitFor(() => boardTabs().length === 1, { message: 'the board tab to open' })
    await vscode.window.tabGroups.close(boardTabs())
    await waitFor(() => boardTabs().length === 0, { message: 'the board tab to close' })
    await vscode.commands.executeCommand('knote.openBoard')
    await waitFor(() => boardTabs().length === 1, { message: 'the board tab to reopen' })
  })
})
