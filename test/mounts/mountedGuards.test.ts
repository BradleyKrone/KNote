// The data-loss guards. A mounted folder is a workspace folder that merely
// *appears* in the vault tree — its real home is somewhere else on disk. Delete
// or rename its row and KNote would trash or relocate the whole folder, so both
// are refused. These commands are reachable from the command palette, which
// ignores the menus' `when` clauses, hence the runtime guard being tested here.

import * as assert from 'assert'
import {
  activateExtension,
  existsOnDisk,
  mountName,
  mountRoot,
  mountUri,
  vaultRoot,
  waitFor
} from './helpers'
import * as vscode from 'vscode'

describe('a mounted folder cannot be destroyed from the vault tree', () => {
  before(async () => {
    await activateExtension()
    // The mount only exists once the engine has indexed it.
    await waitFor(
      async () => (await vscode.commands.getCommands(true)).includes('knote.files.delete'),
      { message: 'KNote commands registered' }
    )
  })

  it('refuses to delete the mount root, leaving the folder on disk', async () => {
    await vscode.commands.executeCommand('knote.files.delete', mountName(), true)
    assert.ok(
      await existsOnDisk(mountRoot()),
      'the mounted folder was deleted — the guard in vaultService/filesTree did not hold'
    )
    assert.ok(await existsOnDisk(mountUri('docs/Mounted Note.md')))
  })

  it('refuses to rename the mount root, so it stays where it lives', async () => {
    await vscode.commands.executeCommand('knote.files.rename', mountName(), 'renamed-folder')
    assert.ok(await existsOnDisk(mountRoot()))
    assert.ok(
      !(await existsOnDisk(vscode.Uri.joinPath(vaultRoot(), 'renamed-folder'))),
      'the mounted folder was moved into the vault'
    )
  })

  it('refuses to move the mount root into a vault folder', async () => {
    await vscode.commands.executeCommand('knote.files.move', [mountName()], '')
    assert.ok(await existsOnDisk(mountRoot()))
  })
})
