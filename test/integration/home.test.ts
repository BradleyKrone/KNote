// The Home page's runtime surface, black-box: the command and its startup
// setting are contributed, and opening Home twice reveals the one panel rather
// than stacking a second tab — the singleton guard the startup auto-open leans
// on so it never doubles up with a Home the user already had open.

import * as assert from 'assert'
import * as vscode from 'vscode'
import { activateExtension, closeAllEditors, waitFor } from './helpers'

function homeTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter(
      (t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith('knote.home')
    )
}

describe('home', () => {
  before(async () => {
    await activateExtension()
  })

  after(async () => {
    await closeAllEditors()
  })

  it('registers the command and the open-on-startup setting', async () => {
    const commands = await vscode.commands.getCommands(true)
    assert.ok(commands.includes('knote.openHome'))
    const setting = vscode.workspace.getConfiguration('knote').inspect('home.openOnStartup')
    assert.strictEqual(setting?.defaultValue, true)
  })

  it('opens a single Home panel, revealing it on a second run', async () => {
    await closeAllEditors()
    await vscode.commands.executeCommand('knote.openHome')
    await waitFor(() => homeTabs().length === 1, { message: 'the Home tab to open' })
    await vscode.commands.executeCommand('knote.openHome')
    assert.strictEqual(homeTabs().length, 1)
    assert.strictEqual(homeTabs()[0].label, 'KNote Home')
  })
})
