// A folder joins the vault the moment it joins the workspace — the whole reason
// `onDidChangeWorkspaceFolders` restarts the engine. This also covers the
// regression that restart made possible: `start()` used to register docSync /
// attachment cleanup / renameLinks every time it ran, so a second start would
// double every listener and apply each edit twice.
//
// The folder added here is a *third* one, created and torn down by the test, so
// the vault and the mounted folder the other suites rely on are left alone.

import * as assert from 'assert'
import { promises as fs } from 'fs'
import { basename, join } from 'path'
import { tmpdir } from 'os'
import * as vscode from 'vscode'
import { activateExtension, closeAllEditors, linkResolvesTo, vaultUri, waitFor } from './helpers'

describe('adding a folder to the workspace', () => {
  let extra: string

  before(async () => {
    await activateExtension()
    extra = join(tmpdir(), `knote-extra-${Date.now()}`)
    await fs.mkdir(extra, { recursive: true })
    await fs.writeFile(join(extra, 'Late Arrival.md'), '# Late Arrival\n', 'utf-8')
  })

  after(async () => {
    const folders = vscode.workspace.workspaceFolders ?? []
    const idx = folders.findIndex((f) => f.uri.fsPath === extra)
    if (idx >= 0) {
      vscode.workspace.updateWorkspaceFolders(idx, 1)
      await waitFor(
        () => !(vscode.workspace.workspaceFolders ?? []).some((f) => f.uri.fsPath === extra),
        { message: 'the extra folder to be removed' }
      )
    }
    await fs.rm(extra, { recursive: true, force: true })
    await closeAllEditors()
  })

  it('mounts and indexes a folder added after startup, without reopening the window', async () => {
    const source = vaultUri('FindsLateArrival.md')
    await vscode.workspace.fs.writeFile(source, Buffer.from('See [[Late Arrival]]\n', 'utf-8'))
    assert.strictEqual(
      await linkResolvesTo(source),
      null,
      'the note in the extra folder resolved before its folder was in the workspace'
    )

    const count = vscode.workspace.workspaceFolders?.length ?? 0
    assert.ok(
      vscode.workspace.updateWorkspaceFolders(count, 0, { uri: vscode.Uri.file(extra) }),
      'could not add a workspace folder'
    )
    await waitFor(() => (vscode.workspace.workspaceFolders?.length ?? 0) === count + 1, {
      message: 'the extra folder to be added'
    })

    // The mount-prefixed path is the proof: the restart re-indexed the vault
    // across the newly added folder, and named it after that folder.
    const expected = `${basename(extra)}/Late Arrival.md`
    await waitFor(async () => (await linkResolvesTo(source)) === expected, {
      timeout: 20000,
      message: `[[Late Arrival]] to resolve to ${expected}`
    })
  })

  it('applies each edit once — the restart did not double-register its listeners', async () => {
    const uri = vaultUri('DoubleWrite.md')
    await vscode.workspace.fs.writeFile(uri, Buffer.from('- [ ] task\n', 'utf-8'))
    const doc = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(doc)
    editor.selection = new vscode.Selection(0, 0, 0, 0)

    await vscode.commands.executeCommand('knote.cycleTaskStatus')
    await doc.save()

    const taskLines = doc
      .getText()
      .split('\n')
      .filter((l) => l.includes('task'))
    assert.strictEqual(
      taskLines.length,
      1,
      `expected one task line after the restart, got ${taskLines.length}:\n${doc.getText()}`
    )
  })
})
