// The `@task` marker end to end: that task-ness now follows the marker rather
// than indentation, that an unmarked checkbox is refused as a card, and that
// `knote.migrateLegacyTasks` converts a pre-marker note on disk (twice, with
// the second run a no-op).
//
// Black-box on purpose — only `vscode` and Node — so it exercises the real
// activation, command wiring and verified-edit path a unit test can't reach.
//
// Each case writes its own note: a note written to disk while an editor is
// already open on it keeps showing the buffer's stale text, which is a test
// artefact, not the behaviour under test.

import * as assert from 'assert'
import * as vscode from 'vscode'
import {
  activateExtension,
  closeAllEditors,
  delay,
  openNoteAtLine,
  readNoteOnDisk,
  waitFor,
  writeNoteOnDisk
} from './helpers'

/** Write a note and open it, once the extension has seen the file. */
async function seedAndOpen(
  relPath: string,
  lines: string[],
  line: number
): Promise<vscode.TextEditor> {
  await writeNoteOnDisk(relPath, lines.join('\n'))
  return openNoteAtLine(relPath, line)
}

describe('the @task marker', () => {
  before(async () => {
    await activateExtension()
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('treats an indented @task line as a card, wherever it sits', async () => {
    const editor = await seedAndOpen(
      'MarkerIndented.md',
      ['# Marker', '', '- Site notes', '    - [ ] @task Rewire the controller', ''],
      3
    )
    assert.strictEqual(editor.document.lineAt(3).text, '    - [ ] @task Rewire the controller')

    await vscode.commands.executeCommand('knote.cycleTaskStatus')

    await waitFor(
      () => editor.document.lineAt(3).text.startsWith('    - [r] @task Rewire the controller'),
      { message: 'an indented task to take the next status char' }
    )
    await waitFor(
      async () =>
        (await readNoteOnDisk('MarkerIndented.md')).includes(
          '    - [r] @task Rewire the controller'
        ),
      { message: 'disk to agree' }
    )
    // The status stamp lands under it at the task's own indent, not column 0.
    const onDisk = await readNoteOnDisk('MarkerIndented.md')
    assert.ok(
      onDisk.includes('      - Status Changed:'),
      'the Status Changed stamp should sit one level under the task'
    )
  })

  it('refuses a flush-left checkbox that carries no marker', async () => {
    const editor = await seedAndOpen(
      'MarkerUnmarked.md',
      ['# Marker', '', '- [ ] Not a card', ''],
      2
    )
    assert.strictEqual(editor.document.lineAt(2).text, '- [ ] Not a card')

    await vscode.commands.executeCommand('knote.cycleTaskStatus')
    // Nothing to converge on — give any (wrong) write a chance to land first.
    await delay(300)

    assert.strictEqual(editor.document.lineAt(2).text, '- [ ] Not a card')
    const onDisk = await readNoteOnDisk('MarkerUnmarked.md')
    assert.ok(onDisk.includes('- [ ] Not a card'), 'the unmarked checkbox must be untouched')
    assert.ok(!onDisk.includes('Status Changed'), 'no stamp should be written under a non-card')
  })

  it('toggles the marker on and off with knote.toggleTaskMarker', async () => {
    const editor = await seedAndOpen('MarkerToggle.md', ['# Marker', '', '- [ ] Promote me', ''], 2)
    assert.strictEqual(editor.document.lineAt(2).text, '- [ ] Promote me')

    await vscode.commands.executeCommand('knote.toggleTaskMarker')
    await waitFor(() => editor.document.lineAt(2).text === '- [ ] @task Promote me', {
      message: 'the checkbox to gain the marker'
    })

    await vscode.commands.executeCommand('knote.toggleTaskMarker')
    await waitFor(() => editor.document.lineAt(2).text === '- [ ] Promote me', {
      message: 'the marker to come back off'
    })
  })
})

describe('knote.migrateLegacyTasks', () => {
  // Legacy.md ships in the fixture vault, so it is indexed at startup like any
  // other note — the migration reads the index, not the disk, and a note
  // written mid-run has not necessarily reached it yet.
  const LEGACY = 'Legacy.md'

  before(async () => {
    await activateExtension()
  })

  after(async () => {
    await closeAllEditors()
  })

  it('marks what the old rule made a card, and nothing else', async () => {
    assert.ok(
      (await readNoteOnDisk(LEGACY)).includes('- [ ] First task'),
      'the fixture should start unconverted'
    )

    await vscode.commands.executeCommand('knote.migrateLegacyTasks', { confirm: false })

    await waitFor(async () => (await readNoteOnDisk(LEGACY)).includes('- [ ] @task First task'), {
      message: 'the first task to gain the marker',
      timeout: 15000
    })

    const onDisk = await readNoteOnDisk(LEGACY)
    assert.ok(onDisk.includes('- [x] @task Second task'), 'second card converted, status preserved')
    assert.ok(
      onDisk.includes('  - [ ] a step, must stay plain'),
      'an indented sub-checkbox must stay plain'
    )
    assert.ok(onDisk.includes('  - [ ] its step'), 'the converted task’s step stays plain')
    assert.ok(
      onDisk.includes('- [ ] fake, inside a fence'),
      'a checkbox inside a fenced sample must be untouched'
    )
    assert.ok(!onDisk.includes('@task @task'), 'no line may be marked twice')
  })

  it('is a no-op on a second run', async () => {
    const before = await readNoteOnDisk(LEGACY)
    await vscode.commands.executeCommand('knote.migrateLegacyTasks', { confirm: false })
    await delay(1000)
    assert.strictEqual(await readNoteOnDisk(LEGACY), before, 'the file must be byte-identical')
  })
})
