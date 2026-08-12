// The board's global/folder "Add card" appends into the current weekly note
// rather than a fixed inbox note (see boardActions.addCard). Unit tests can't
// see this part: it lands the new card at the end of the note's "## Tasks"
// section — not blindly at the end of the file, which would otherwise drop
// it under whatever section happens to come last (e.g. a day-by-day
// journal) — and that lookup depends on the live vault index having picked
// up the note's headings.

import * as assert from 'assert'
import * as vscode from 'vscode'
import {
  activateExtension,
  closeAllEditors,
  readNoteOnDisk,
  vaultUri,
  waitFor,
  writeNoteOnDisk
} from './helpers'

const NOTE = 'WeeklyTasksHeading.md'
const PLAIN_NOTE = 'WeeklyNoTasksHeading.md'
const LINKER = 'WeeklyTasksHeadingLinker.md'

/**
 * True once the vault index has picked up NOTE's "Tasks" heading — driven
 * through the same `[[Note#` heading-completion provider the editor uses,
 * so this polls the exact data `appendUnderTasksHeading` reads.
 */
async function tasksHeadingIndexed(): Promise<boolean> {
  const doc = await vscode.workspace.openTextDocument(vaultUri(LINKER))
  const editor = await vscode.window.showTextDocument(doc)
  const line = doc.lineCount - 1
  const at = new vscode.Position(line, doc.lineAt(line).text.length)
  await editor.edit((b) => b.insert(at, '[[WeeklyTasksHeading#'))
  const pos = new vscode.Position(line, doc.lineAt(line).text.length)

  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    doc.uri,
    pos
  )
  return (list?.items ?? []).some((i) => {
    const label = typeof i.label === 'string' ? i.label : i.label.label
    return label === 'Tasks'
  })
}

describe('board add-card: lands under a weekly note\'s "Tasks" heading', () => {
  before(async () => {
    await activateExtension()
    await writeNoteOnDisk(LINKER, '# Linker\n\n')
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('inserts at the end of the Tasks section, not after a later section', async () => {
    await writeNoteOnDisk(
      NOTE,
      ['## Tasks', '- [ ] Existing task', '', '## Notes', '### Monday', ''].join('\n')
    )
    await waitFor(() => tasksHeadingIndexed(), {
      timeout: 10000,
      message: 'the index to pick up the Tasks heading'
    })

    await vscode.commands.executeCommand('knote.appendUnderTasksHeading', NOTE, '- [ ] New card')

    await waitFor(async () => (await readNoteOnDisk(NOTE)).includes('New card'), {
      message: 'the new card to land on disk'
    })
    assert.deepStrictEqual((await readNoteOnDisk(NOTE)).split(/\r?\n/), [
      '## Tasks',
      '- [ ] Existing task',
      '- [ ] New card',
      '',
      '## Notes',
      '### Monday',
      ''
    ])
  })

  it('falls back to a plain end-of-file append when there is no Tasks heading', async () => {
    await writeNoteOnDisk(PLAIN_NOTE, ['## Notes', 'just some notes', ''].join('\n'))

    await vscode.commands.executeCommand(
      'knote.appendUnderTasksHeading',
      PLAIN_NOTE,
      '- [ ] New card'
    )

    await waitFor(async () => (await readNoteOnDisk(PLAIN_NOTE)).includes('New card'), {
      message: 'the new card to land on disk'
    })
    const onDisk = await readNoteOnDisk(PLAIN_NOTE)
    assert.ok(onDisk.trim().endsWith('- [ ] New card'), `expected append at EOF, got: ${onDisk}`)
  })
})
