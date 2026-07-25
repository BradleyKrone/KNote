// Renaming a note rewrites the [[wiki links]] that point at it — Obsidian's
// "automatically update internal links", exercised end-to-end in a real host.
//
// This can only be tested here: the rewrite rides on onWillRenameFiles +
// waitUntil, so it needs VS Code's real file-operation pipeline to fire at all.

import * as assert from 'assert'
import { promises as fs } from 'fs'
import * as vscode from 'vscode'
import {
  activateExtension,
  closeAllEditors,
  delay,
  openNoteAtLine,
  readNoteOnDisk,
  vaultUri,
  waitFor,
  writeNoteOnDisk
} from './helpers'

/**
 * Create a note *and* guarantee KNote has indexed it, without racing the
 * filesystem watcher: an editor save routes through docSync, which reindexes
 * the saved text synchronously. Link rewriting resolves against the index, so
 * a note the index hasn't seen yet simply has no links to rewrite.
 */
async function createIndexedNote(relPath: string, content: string): Promise<void> {
  await writeNoteOnDisk(relPath, '')
  const doc = await vscode.workspace.openTextDocument(vaultUri(relPath))
  const editor = await vscode.window.showTextDocument(doc)
  await editor.edit((b) => b.insert(new vscode.Position(0, 0), content))
  await doc.save()
}

/** Rename via the workspace API so onWillRenameFiles participants run. */
async function renameNote(fromRel: string, toRel: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit()
  edit.renameFile(vaultUri(fromRel), vaultUri(toRel))
  const ok = await vscode.workspace.applyEdit(edit)
  assert.ok(ok, `rename ${fromRel} → ${toRel} was not applied`)
}

/** Disk text with line endings normalized — an editor save uses the platform EOL. */
async function readNormalized(relPath: string): Promise<string> {
  return (await readNoteOnDisk(relPath)).replace(/\r\n/g, '\n')
}

async function removeIfPresent(...relPaths: string[]): Promise<void> {
  for (const rel of relPaths) {
    await fs.rm(vaultUri(rel).fsPath, { force: true, recursive: true })
  }
}

describe('link update on rename', () => {
  before(async () => {
    await activateExtension()
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('rewrites links in a closed note when the target is renamed', async () => {
    await removeIfPresent('RenameTarget.md', 'RenameRenamed.md', 'RenameSource.md')
    await createIndexedNote('RenameTarget.md', '# Target\n\nBody.\n')
    await createIndexedNote(
      'RenameSource.md',
      'See [[RenameTarget]] and [[RenameTarget#Heading]] and [[RenameTarget|alias text]].\n'
    )
    await closeAllEditors()

    await renameNote('RenameTarget.md', 'RenameRenamed.md')

    const updated = await waitFor(
      async () => {
        const text = await readNormalized('RenameSource.md')
        return text.includes('RenameRenamed') ? text : ''
      },
      { message: 'links rewritten on disk' }
    )
    assert.strictEqual(
      updated,
      'See [[RenameRenamed]] and [[RenameRenamed#Heading]] and [[RenameRenamed|alias text]].\n'
    )

    await removeIfPresent('RenameRenamed.md', 'RenameSource.md')
  })

  it('rewrites links in an open buffer, preserving its unsaved edits', async () => {
    await removeIfPresent('OpenTarget.md', 'OpenRenamed.md', 'OpenSource.md')
    await createIndexedNote('OpenTarget.md', '# Open Target\n')
    await createIndexedNote('OpenSource.md', 'Link: [[OpenTarget]]\n')

    const editor = await openNoteAtLine('OpenSource.md', 0)
    // An unsaved edit the rewrite must not clobber.
    await editor.edit((b) => {
      b.insert(new vscode.Position(1, 0), 'unsaved line\n')
    })
    assert.ok(editor.document.isDirty, 'expected an unsaved buffer')

    await renameNote('OpenTarget.md', 'OpenRenamed.md')

    await waitFor(() => editor.document.getText().includes('[[OpenRenamed]]'), {
      message: 'links rewritten in the open buffer'
    })
    assert.ok(
      editor.document.getText().includes('unsaved line'),
      'the unsaved edit must survive the link rewrite'
    )

    await closeAllEditors()
    await removeIfPresent('OpenRenamed.md', 'OpenSource.md')
  })

  it('rewrites links to every note inside a renamed folder', async () => {
    await removeIfPresent('RenFolder', 'RenFolder2', 'FolderSource.md')
    await fs.mkdir(vaultUri('RenFolder').fsPath, { recursive: true })
    await createIndexedNote('RenFolder/Inner.md', '# Inner\n')
    await createIndexedNote('FolderSource.md', 'Path link: [[RenFolder/Inner]]\n')
    await closeAllEditors()

    await renameNote('RenFolder', 'RenFolder2')

    const updated = await waitFor(
      async () => {
        const text = await readNormalized('FolderSource.md')
        return text.includes('RenFolder2') ? text : ''
      },
      { message: 'folder-rename links rewritten' }
    )
    assert.strictEqual(updated, 'Path link: [[RenFolder2/Inner]]\n')

    await removeIfPresent('RenFolder2', 'FolderSource.md')
  })

  it('leaves alone links that point at a different note', async () => {
    await removeIfPresent('UnrelatedA.md', 'UnrelatedARenamed.md', 'UnrelatedSource.md')
    await createIndexedNote('UnrelatedA.md', '# A\n')
    await createIndexedNote('UnrelatedSource.md', 'Points at [[Sample]] only.\n')
    await closeAllEditors()

    await renameNote('UnrelatedA.md', 'UnrelatedARenamed.md')

    // Nothing to rewrite: give the participant a beat, then assert it stayed put.
    await delay(500)
    assert.strictEqual(await readNormalized('UnrelatedSource.md'), 'Points at [[Sample]] only.\n')

    await removeIfPresent('UnrelatedARenamed.md', 'UnrelatedSource.md')
  })
})
