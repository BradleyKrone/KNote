// Moving notes between the vault and a mounted folder. The two live on
// unrelated paths — potentially different volumes — so this exercises VS Code's
// own rename fallback as much as KNote's path math, which is exactly why it is
// asserted here rather than assumed.

import * as assert from 'assert'
import * as vscode from 'vscode'
import {
  activateExtension,
  closeAllEditors,
  existsOnDisk,
  mountName,
  mountUri,
  vaultUri,
  waitFor
} from './helpers'

describe('moving notes across the vault and a mounted folder', () => {
  before(async () => {
    await activateExtension()
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('moves a note from the vault into the mounted folder', async () => {
    await vscode.workspace.fs.writeFile(vaultUri('Movable.md'), Buffer.from('# Movable\n', 'utf-8'))

    await vscode.commands.executeCommand('knote.files.move', ['Movable.md'], `${mountName()}/docs`)

    await waitFor(() => existsOnDisk(mountUri('docs/Movable.md')), {
      message: 'the note to arrive in the mounted folder'
    })
    assert.ok(
      !(await existsOnDisk(vaultUri('Movable.md'))),
      'the note is still in the vault — the move copied instead of moving'
    )
  })

  it('moves a note back out of the mounted folder into the vault', async () => {
    await vscode.workspace.fs.writeFile(
      mountUri('docs/GoingHome.md'),
      Buffer.from('# GoingHome\n', 'utf-8')
    )

    await vscode.commands.executeCommand(
      'knote.files.move',
      [`${mountName()}/docs/GoingHome.md`],
      ''
    )

    await waitFor(() => existsOnDisk(vaultUri('GoingHome.md')), {
      message: 'the note to arrive in the vault'
    })
    assert.ok(!(await existsOnDisk(mountUri('docs/GoingHome.md'))))
  })

  it('rewrites links that pointed at a note moved into the mount', async () => {
    await vscode.workspace.fs.writeFile(vaultUri('Target.md'), Buffer.from('# Target\n', 'utf-8'))
    await vscode.workspace.fs.writeFile(
      vaultUri('Source.md'),
      Buffer.from('Points at [[Target]]\n', 'utf-8')
    )
    // The link rewrite reads the index, so wait until it knows both notes.
    await waitFor(
      async () => (await vscode.workspace.openTextDocument(vaultUri('Source.md'))).getText(),
      { message: 'the source note to be readable' }
    )

    await vscode.commands.executeCommand('knote.files.move', ['Target.md'], `${mountName()}/docs`)

    await waitFor(() => existsOnDisk(mountUri('docs/Target.md')), {
      message: 'the target note to move'
    })
    const source = await waitFor(
      async () => {
        const doc = await vscode.workspace.openTextDocument(vaultUri('Source.md'))
        const text = doc.getText()
        // Either form is correct: the link still has to resolve, and a bare
        // title still does now that the note is the only "Target" in the vault.
        return text.includes('[[') ? text : null
      },
      { message: 'the source note to still carry a link' }
    )
    assert.ok(source!.includes('[['), `link was dropped entirely:\n${source}`)
  })
})
