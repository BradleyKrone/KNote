// Planner → "Open in editor" on a deliverable in a note that has never been
// opened in a tab yet. Opening an already-open note just reveals its panel;
// a never-opened one has to go through `vscode.openWith` with the line held
// in `pendingReveal`, which is the path this covers — with the Planner as the
// active tab, the way it is when the menu item is clicked.

import * as assert from 'assert'
import * as vscode from 'vscode'
import { activateExtension, closeAllEditors, waitFor, writeNoteOnDisk, delay } from './helpers'

function activeCustomTab(): vscode.TabInputCustom | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
  return input instanceof vscode.TabInputCustom ? input : undefined
}

describe('opening a never-opened note at a line', () => {
  before(async () => {
    await activateExtension()
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('opens a just-created note from the Planner tab', async () => {
    const path = 'Fresh Project.md'
    await writeNoteOnDisk(
      path,
      [
        '---',
        'type: project',
        'project: fresh',
        '---',
        '',
        '- [ ] @task Design 🛫 2026-04-01 📅 2026-04-20 @deliverable(fresh/design)',
        ''
      ].join('\n')
    )
    // Let the watcher index it, as it would be by the time it's charted.
    await delay(1500)

    await vscode.commands.executeCommand('knote.openPlanner')
    await waitFor(
      () =>
        vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview,
      {
        message: 'the Planner to be the active tab'
      }
    )

    await vscode.commands.executeCommand('knote.openNoteAt', path, 5)

    await waitFor(
      () =>
        activeCustomTab()?.uri.path.endsWith('/Fresh%20Project.md') ||
        activeCustomTab()?.uri.fsPath.endsWith('Fresh Project.md'),
      { message: 'the never-opened note to open in the live editor' }
    )
    assert.strictEqual(activeCustomTab()?.viewType, 'knote.liveEditor')
  })
})
