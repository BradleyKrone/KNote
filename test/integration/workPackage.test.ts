// Work packages (`@parent(<name>)`) round-trip through a live host the same
// way every other deliverable marker does — unit tests cover the resolution
// logic, this proves the two things they can't see: the marker survives a
// real verified edit with its block anchor still last (AFTER_ANCHOR), and the
// task dialog's "Work package of…" picker's write path — `knote.setTaskNote`,
// the same RPC the dialog's Save button calls — lands the marker on disk.

import * as assert from 'assert'
import * as vscode from 'vscode'
import {
  activateExtension,
  closeAllEditors,
  openNoteAtLine,
  readNoteOnDisk,
  waitFor,
  writeNoteOnDisk
} from './helpers'

const PROJECT_NOTE = 'WorkPackageProject.md'
const RELEASE = '- [ ] @task Release 1 🛫 2026-01-01 📅 2026-03-01 @deliverable(software/release-1)'
const FIX_BUGS =
  '- [ ] @task Fix product bugs 🛫 2026-01-15 📅 2026-02-01 @deliverable(software/fix-bugs) @parent(release-1) ^fix-bugs'

describe('work packages', () => {
  before(async () => {
    await activateExtension()
    await writeNoteOnDisk(
      PROJECT_NOTE,
      ['---', 'type: project', 'project: software', '---', '', '# Software', '', RELEASE, FIX_BUGS, ''].join(
        '\n'
      )
    )
  })

  after(async () => {
    await closeAllEditors()
  })

  it('keeps @parent(...) and the block anchor last through a verified status edit', async () => {
    const editor = await openNoteAtLine(PROJECT_NOTE, 8)
    assert.strictEqual(editor.document.lineAt(8).text, FIX_BUGS)

    await vscode.commands.executeCommand('knote.cycleTaskStatus')

    await waitFor(() => editor.document.lineAt(8).text.startsWith('- [r] @task Fix product bugs'), {
      message: 'the work package’s status char to change'
    })
    const line = editor.document.lineAt(8).text
    assert.ok(line.endsWith('^fix-bugs'), `anchor should still be last, got: ${line}`)
    assert.ok(line.includes('@parent(release-1)'), 'the parent marker should survive')
    assert.ok(line.includes('@deliverable(software/fix-bugs)'), 'its own deliverable marker should survive')

    await waitFor(
      async () => (await readNoteOnDisk(PROJECT_NOTE)).includes('- [r] @task Fix product bugs'),
      { message: 'disk to reflect the edit' }
    )
    const onDisk = await readNoteOnDisk(PROJECT_NOTE)
    const diskLine = onDisk.split(/\r?\n/).find((l) => l.includes('Fix product bugs')) ?? ''
    assert.ok(diskLine.endsWith('^fix-bugs'), `anchor should be last on disk, got: ${diskLine}`)
    assert.ok(diskLine.includes('@parent(release-1)'), 'the parent marker should be on disk')
  })

  it('sets a deliverable’s parent via the same RPC the task dialog’s picker saves through', async () => {
    const NOTE = 'WorkPackagePicker.md'
    const LINE =
      '- [ ] @task Fix login crash 🛫 2026-01-15 📅 2026-01-20 @deliverable(software/login-crash)'
    await writeNoteOnDisk(
      NOTE,
      ['---', 'type: project', 'project: software', '---', '', LINE, ''].join('\n')
    )

    // The dialog's "Work package of…" picker calls setParentDeliverableRef on
    // the title text, then saves through the ordinary task-dialog RPC.
    const withParent = `${LINE} @parent(fix-bugs)`
    await vscode.commands.executeCommand('knote.setTaskNote', NOTE, 5, LINE, withParent, [])

    await waitFor(async () => (await readNoteOnDisk(NOTE)).includes('@parent(fix-bugs)'), {
      message: 'the parent marker to reach disk'
    })

    // Clearing it (the picker's "None" row) removes the marker again.
    await vscode.commands.executeCommand('knote.setTaskNote', NOTE, 5, withParent, LINE, [])
    await waitFor(async () => !(await readNoteOnDisk(NOTE)).includes('@parent'), {
      message: 'the parent marker to be cleared on disk'
    })
  })
})
