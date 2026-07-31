// The Planner's runtime surface, black-box: the panel command is wired up (and
// the Timeline it replaced is gone), and a real deliverable line — with a start
// date, a dependency marker and a block anchor on it — survives a verified edit
// inside a live VS Code host with its anchor still last.
//
// That last part is the one the unit suite can't see: AFTER_ANCHOR is what
// keeps `^id` at the end of the line, and if it doesn't cover 🛫/⛓ then every
// `[[Note#^id]]` pointing at a deliverable quietly breaks the first time the
// task's status changes.

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

const PROJECT_NOTE = 'PlannerProject.md'
const DELIVERABLE =
  '- [ ] Design 🛫 2026-04-01 📅 2026-04-20 #deliverable/planner/design ⛓ #deliverable/planner/contracts ^design1'

describe('planner', () => {
  before(async () => {
    await activateExtension()
    await writeNoteOnDisk(
      PROJECT_NOTE,
      [
        '---',
        'type: project',
        'project: planner',
        '---',
        '',
        '# Planner Project',
        '',
        '- [ ] Contracts 🛫 2026-03-20 📅 2026-03-31 #deliverable/planner/contracts',
        DELIVERABLE,
        ''
      ].join('\n')
    )
  })

  after(async () => {
    await closeAllEditors()
  })

  it('registers the planner command and no longer registers the timeline it replaced', async () => {
    const registered = new Set(await vscode.commands.getCommands(true))
    assert.ok(registered.has('knote.openPlanner'), 'knote.openPlanner should be registered')
    assert.ok(
      !registered.has('knote.openTimeline'),
      'knote.openTimeline was replaced by the planner and should be gone'
    )
  })

  it('opens the planner panel', async () => {
    await vscode.commands.executeCommand('knote.openPlanner')
    // Opening twice must reveal the singleton rather than throw or stack panels.
    await vscode.commands.executeCommand('knote.openPlanner')
  })

  it('keeps a deliverable line’s block anchor last through a verified status edit', async () => {
    const editor = await openNoteAtLine(PROJECT_NOTE, 8)
    assert.strictEqual(editor.document.lineAt(8).text, DELIVERABLE)

    await vscode.commands.executeCommand('knote.cycleTaskStatus')

    await waitFor(() => editor.document.lineAt(8).text.startsWith('- [r] Design'), {
      message: 'the deliverable status char to change'
    })
    const line = editor.document.lineAt(8).text
    assert.ok(line.endsWith('^design1'), `anchor should still be last, got: ${line}`)
    assert.ok(line.includes('🛫 2026-04-01'), 'the start date should survive')
    assert.ok(line.includes('📅 2026-04-20'), 'the end date should survive')
    assert.ok(
      line.includes('⛓ #deliverable/planner/contracts'),
      'the dependency marker should survive'
    )

    await waitFor(async () => (await readNoteOnDisk(PROJECT_NOTE)).includes('- [r] Design'), {
      message: 'disk to reflect the edit'
    })
    const onDisk = await readNoteOnDisk(PROJECT_NOTE)
    const diskLine = onDisk.split(/\r?\n/).find((l) => l.includes('Design')) ?? ''
    assert.ok(diskLine.endsWith('^design1'), `anchor should be last on disk, got: ${diskLine}`)
  })
})
