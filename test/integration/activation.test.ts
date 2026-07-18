// Smoke tests: the extension activates against the fixture vault and every
// command it contributes is actually registered. This is the cheapest guard
// against a broken activation path or a command declared in package.json but
// never wired up — the kind of thing the unit suite can't see.

import * as assert from 'assert'
import * as vscode from 'vscode'
import { activateExtension } from './helpers'

describe('activation', () => {
  it('activates when a vault is open', async () => {
    const ext = await activateExtension()
    assert.strictEqual(ext.isActive, true)
  })

  it('detects the fixture vault (workspace has a .knote folder)', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0]
    assert.ok(folder, 'a workspace folder should be open')
    const knote = await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, '.knote'))
    assert.strictEqual(knote.type & vscode.FileType.Directory, vscode.FileType.Directory)
  })

  it('registers every command declared in package.json', async () => {
    await activateExtension()
    const registered = new Set(await vscode.commands.getCommands(true))
    // A representative slice across the command surface; each must resolve.
    const expected = [
      'knote.openBoard',
      'knote.openTimeline',
      'knote.cycleTaskStatus',
      'knote.setTaskStatus',
      'knote.insertCheckbox',
      'knote.insertTaskNote',
      'knote.openWeeklyNote',
      'knote.quickCapture',
      'knote.searchVault',
      'knote.renameTag'
    ]
    const missing = expected.filter((cmd) => !registered.has(cmd))
    assert.deepStrictEqual(missing, [], `unregistered commands: ${missing.join(', ')}`)
  })
})
