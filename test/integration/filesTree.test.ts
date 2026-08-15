// The Files view's commands, driven in a real host. The load-bearing
// assertion is the rename one: it passes only if the command routed through
// a WorkspaceEdit (which fires the onWillRenameFiles participant that
// rewrites [[wiki links]]) rather than workspace.fs.rename, which would move
// the file just as successfully while silently breaking every link to it.

import * as assert from 'assert'
import { promises as fs } from 'fs'
import * as vscode from 'vscode'
import {
  activateExtension,
  closeAllEditors,
  readNoteOnDisk,
  vaultUri,
  waitFor,
  writeNoteOnDisk
} from './helpers'

/**
 * Create a note and guarantee KNote has indexed it — an editor save routes
 * through docSync, which reindexes synchronously. Link rewriting resolves
 * against the index, so a note the index hasn't seen has no links to rewrite.
 */
async function createIndexedNote(relPath: string, content: string): Promise<void> {
  await writeNoteOnDisk(relPath, '')
  const doc = await vscode.workspace.openTextDocument(vaultUri(relPath))
  const editor = await vscode.window.showTextDocument(doc)
  await editor.edit((b) => b.insert(new vscode.Position(0, 0), content))
  await doc.save()
}

async function exists(relPath: string): Promise<boolean> {
  try {
    await fs.stat(vaultUri(relPath).fsPath)
    return true
  } catch {
    return false
  }
}

async function removeIfPresent(...relPaths: string[]): Promise<void> {
  for (const rel of relPaths) {
    await fs.rm(vaultUri(rel).fsPath, { force: true, recursive: true })
  }
}

describe('Files view commands', () => {
  before(async () => {
    await activateExtension()
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  afterEach(async () => {
    // The view browses one folder at a time; put it back at the vault root so
    // the folder a test left open can't leak into the next one.
    await vscode.commands.executeCommand('knote.files.openFolder', '')
  })

  it('creates a folder and a note inside it', async () => {
    await removeIfPresent('FilesNew')

    await vscode.commands.executeCommand('knote.files.newFolder', '', 'FilesNew')
    assert.ok(await exists('FilesNew'), 'expected the folder on disk')

    await vscode.commands.executeCommand('knote.files.newNote', 'FilesNew', 'Fresh')
    assert.ok(await exists('FilesNew/Fresh.md'), 'expected the note on disk, with .md appended')

    await closeAllEditors()
    await removeIfPresent('FilesNew')
  })

  // Browsing state is only observable through what the commands then act on:
  // a create with no folder argument goes into whatever folder is on screen.
  it('creates into the folder it has been browsed into, and back out again', async () => {
    await removeIfPresent('FilesNav')
    await fs.mkdir(vaultUri('FilesNav/Deep').fsPath, { recursive: true })

    await vscode.commands.executeCommand('knote.files.openFolder', 'FilesNav/Deep')
    await vscode.commands.executeCommand('knote.files.newNote', undefined, 'Inner')
    assert.ok(await exists('FilesNav/Deep/Inner.md'), 'expected the note in the browsed folder')

    await vscode.commands.executeCommand('knote.files.goUp')
    await vscode.commands.executeCommand('knote.files.newNote', undefined, 'Outer')
    assert.ok(await exists('FilesNav/Outer.md'), 'expected the note one folder out')

    await vscode.commands.executeCommand('knote.files.goUp')
    await vscode.commands.executeCommand('knote.files.newNote', undefined, 'FilesNavRoot')
    assert.ok(await exists('FilesNavRoot.md'), 'expected the note at the vault root')

    // Already at the root: going up again must stay put, not escape the vault.
    await vscode.commands.executeCommand('knote.files.goUp')
    await vscode.commands.executeCommand('knote.files.newNote', undefined, 'FilesNavStillRoot')
    assert.ok(await exists('FilesNavStillRoot.md'), 'expected to still be at the vault root')

    await closeAllEditors()
    await removeIfPresent('FilesNav', 'FilesNavRoot.md', 'FilesNavStillRoot.md')
  })

  it('creating a folder steps into it', async () => {
    await removeIfPresent('FilesStep')

    await vscode.commands.executeCommand('knote.files.newFolder', '', 'FilesStep')
    // No folder argument, so this lands wherever the view now is.
    await vscode.commands.executeCommand('knote.files.newNote', undefined, 'Landed')
    assert.ok(await exists('FilesStep/Landed.md'), 'expected the view to have stepped inside')

    await closeAllEditors()
    await removeIfPresent('FilesStep')
  })

  it('renames a note and takes the links pointing at it along', async () => {
    await removeIfPresent('FilesTarget.md', 'FilesRenamed.md', 'FilesSource.md')
    await createIndexedNote('FilesTarget.md', '# Target\n')
    await createIndexedNote('FilesSource.md', 'See [[FilesTarget]].\n')
    await closeAllEditors()

    await vscode.commands.executeCommand('knote.files.rename', 'FilesTarget.md', 'FilesRenamed.md')

    assert.ok(await exists('FilesRenamed.md'), 'expected the note at its new path')
    assert.ok(!(await exists('FilesTarget.md')), 'expected the old path to be gone')

    const updated = await waitFor(
      async () => {
        const text = (await readNoteOnDisk('FilesSource.md')).replace(/\r\n/g, '\n')
        return text.includes('FilesRenamed') ? text : ''
      },
      { message: 'links rewritten on disk after a Files-view rename' }
    )
    assert.strictEqual(updated, 'See [[FilesRenamed]].\n')

    await removeIfPresent('FilesRenamed.md', 'FilesSource.md')
  })

  // `knote.files.move` is exactly what handleDrop invokes, so driving the
  // command exercises the real drop path — everything but the pointer
  // gesture the harness can't produce.
  it('moves a note between folders, keeping the links to it working', async () => {
    await removeIfPresent('FilesFrom', 'FilesTo', 'FilesMoveSource.md')
    await fs.mkdir(vaultUri('FilesFrom').fsPath, { recursive: true })
    await fs.mkdir(vaultUri('FilesTo').fsPath, { recursive: true })
    await createIndexedNote('FilesFrom/FilesMoveMe.md', '# Move me\n')
    await createIndexedNote(
      'FilesMoveSource.md',
      'Bare: [[FilesMoveMe]].\nPath: [[FilesFrom/FilesMoveMe]].\n'
    )
    await closeAllEditors()

    await vscode.commands.executeCommand(
      'knote.files.move',
      ['FilesFrom/FilesMoveMe.md'],
      'FilesTo'
    )

    // applyEdit resolves once VS Code has accepted the rename; the directory
    // entry itself shows up a beat later, so converge rather than snapshot.
    await waitFor(() => exists('FilesTo/FilesMoveMe.md'), {
      message: 'the note to appear in its new folder'
    })
    assert.ok(!(await exists('FilesFrom/FilesMoveMe.md')), 'expected the old path to be gone')

    const updated = await waitFor(
      async () => {
        const text = (await readNoteOnDisk('FilesMoveSource.md')).replace(/\r\n/g, '\n')
        return text.includes('FilesTo/FilesMoveMe') ? text : ''
      },
      { message: 'the path-form link rewritten on disk after a move' }
    )
    // A bare link resolves by title, so a move leaves it alone — rewriting it
    // would churn the note for nothing. A path-form link has to follow.
    assert.strictEqual(updated, 'Bare: [[FilesMoveMe]].\nPath: [[FilesTo/FilesMoveMe]].\n')

    await removeIfPresent('FilesFrom', 'FilesTo', 'FilesMoveSource.md')
  })

  // Moving something *out* of the folder on screen: there is no ".." row to
  // drop onto, so the context-menu command is the only way to do it.
  it('moves a note out to the vault root by name', async () => {
    await removeIfPresent('FilesOut', 'FilesOutMe.md')
    await fs.mkdir(vaultUri('FilesOut').fsPath, { recursive: true })
    await writeNoteOnDisk('FilesOut/FilesOutMe.md', '# Out\n')

    await vscode.commands.executeCommand('knote.files.moveTo', 'FilesOut/FilesOutMe.md', '')

    await waitFor(() => exists('FilesOutMe.md'), {
      message: 'the note to arrive at the vault root'
    })
    assert.ok(!(await exists('FilesOut/FilesOutMe.md')), 'expected the old path to be gone')

    await removeIfPresent('FilesOut', 'FilesOutMe.md')
  })

  it('refuses a move that would overwrite a note already in the target folder', async () => {
    await removeIfPresent('FilesClash', 'FilesClash.md')
    await fs.mkdir(vaultUri('FilesClash').fsPath, { recursive: true })
    await writeNoteOnDisk('FilesClash/Same.md', '# The one already there\n')
    await writeNoteOnDisk('Same.md', '# The one being dragged\n')

    await vscode.commands.executeCommand('knote.files.move', ['Same.md'], 'FilesClash')

    assert.ok(await exists('Same.md'), 'the dragged note must stay put')
    assert.strictEqual(
      (await readNoteOnDisk('FilesClash/Same.md')).replace(/\r\n/g, '\n'),
      '# The one already there\n',
      'the note in the target folder must not be overwritten'
    )

    await removeIfPresent('FilesClash', 'Same.md')
  })

  it('does not move a folder into its own subtree', async () => {
    await removeIfPresent('FilesSelf')
    await fs.mkdir(vaultUri('FilesSelf/Inner').fsPath, { recursive: true })
    await writeNoteOnDisk('FilesSelf/Inner/Deep.md', '# Deep\n')

    await vscode.commands.executeCommand('knote.files.move', ['FilesSelf'], 'FilesSelf/Inner')

    assert.ok(await exists('FilesSelf/Inner/Deep.md'), 'the folder must be left exactly as it was')
    assert.ok(
      !(await exists('FilesSelf/Inner/FilesSelf')),
      'the folder must not have swallowed itself'
    )

    await removeIfPresent('FilesSelf')
  })

  it('deletes a note', async () => {
    await removeIfPresent('FilesDeleteMe.md')
    await writeNoteOnDisk('FilesDeleteMe.md', '# Bye\n')
    assert.ok(await exists('FilesDeleteMe.md'))

    await vscode.commands.executeCommand('knote.files.delete', 'FilesDeleteMe.md', true)

    await waitFor(async () => !(await exists('FilesDeleteMe.md')), {
      message: 'the deleted note to leave the vault'
    })
  })

  it('copies the full path and the vault-relative path of a note', async () => {
    await removeIfPresent('FilesCopy')
    await fs.mkdir(vaultUri('FilesCopy').fsPath, { recursive: true })
    await writeNoteOnDisk('FilesCopy/Copy Me.md', '# Copy me\n')

    await vscode.commands.executeCommand('knote.files.copyPath', 'FilesCopy/Copy Me.md')
    assert.strictEqual(
      await vscode.env.clipboard.readText(),
      vaultUri('FilesCopy/Copy Me.md').fsPath,
      'expected the absolute path with this platform’s separators'
    )

    await vscode.commands.executeCommand('knote.files.copyRelativePath', 'FilesCopy/Copy Me.md')
    assert.strictEqual(
      await vscode.env.clipboard.readText(),
      'FilesCopy/Copy Me.md',
      'expected the vault-relative path, forward-slashed'
    )

    // A multi-selection copies as one block, one path per line.
    await vscode.commands.executeCommand('knote.files.copyRelativePath', [
      'FilesCopy/Copy Me.md',
      'FilesCopy'
    ])
    assert.strictEqual(await vscode.env.clipboard.readText(), 'FilesCopy/Copy Me.md\nFilesCopy')

    await removeIfPresent('FilesCopy')
  })

  it('leaves the clipboard alone when a copy is invoked without a target', async () => {
    await vscode.env.clipboard.writeText('untouched')
    await vscode.commands.executeCommand('knote.files.copyPath')
    await vscode.commands.executeCommand('knote.files.copyRelativePath')
    assert.strictEqual(await vscode.env.clipboard.readText(), 'untouched')
  })

  it('ignores a rename or delete invoked without a target', async () => {
    // The context-menu commands are palette-hidden, but a keybinding can still
    // fire them with nothing selected — that must be a no-op, not a throw.
    await vscode.commands.executeCommand('knote.files.rename')
    await vscode.commands.executeCommand('knote.files.delete')
    await vscode.commands.executeCommand('knote.files.moveTo')
  })
})
