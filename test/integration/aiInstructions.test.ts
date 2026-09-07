// KNote keeps a living AI-instructions note, Knote Resources/AI Instructions.md,
// in sync with its bundled guide so Claude Code / GitHub Copilot (imported or
// pasted from the user's own instructions file) always see current syntax.
// Unlike everything else scaffolded into a vault, this file IS overwritten
// whenever the bundled content changes — it's an app-managed resource, not
// something the user edits directly.

import * as assert from 'assert'
import * as vscode from 'vscode'
import { activateExtension, readNoteOnDisk, writeNoteOnDisk } from './helpers'

const TARGET = 'Knote Resources/AI Instructions.md'

describe('AI-instructions sync', () => {
  it('creates Knote Resources/AI Instructions.md on activation', async () => {
    await activateExtension()

    const content = await readNoteOnDisk(TARGET)
    assert.ok(content.includes('KNote note-taking conventions'))
    assert.ok(content.includes('@task'))
  })

  it('restores a stale copy back to the bundled guide on the next sync', async () => {
    await activateExtension()

    await writeNoteOnDisk(TARGET, '# An old, stale copy of the guide\n')

    // Re-running the init command re-resolves and reopens the vault, which is
    // exactly the path that re-syncs this file.
    await vscode.commands.executeCommand('knote.initializeVault')

    const content = await readNoteOnDisk(TARGET)
    assert.ok(
      content.includes('KNote note-taking conventions'),
      'a stale copy must be refreshed back to the current bundled guide'
    )
  })
})
