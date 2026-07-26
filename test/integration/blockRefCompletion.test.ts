// Linking to a task must be doable by reading the task, not by hunting for a
// hidden `^id`. That promise lives in two places unit tests can't see: the
// registered CompletionItemProvider (only real once VS Code resolves it against
// a real document and the live index), and `knote.openWikiLink` actually
// resolving the slug anchor a link carries.
//
// Drives the provider through `vscode.executeCompletionItemProvider` — the same
// entry point the `[[` popup uses — and asserts each block-ref suggestion
// carries the task's text and inserts an auto-aliased link.

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

const NOTE = 'BlockRefs.md'
const LINKER = 'BlockRefLinker.md'

function insertTextOf(item: vscode.CompletionItem): string {
  const t = item.insertText
  return typeof t === 'string' ? t : (t?.value ?? '')
}

/** Trigger the `[[BlockRefs#^` completion from the end of a scratch note. */
async function blockRefItems(): Promise<vscode.CompletionItem[]> {
  const doc = await vscode.workspace.openTextDocument(vaultUri(LINKER))
  const editor = await vscode.window.showTextDocument(doc)
  const line = doc.lineCount - 1
  const at = new vscode.Position(line, doc.lineAt(line).text.length)
  await editor.edit((b) => b.insert(at, `[[BlockRefs#^`))
  const pos = new vscode.Position(line, doc.lineAt(line).text.length)

  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    doc.uri,
    pos
  )
  return (list?.items ?? []).filter((i) => {
    const label = typeof i.label === 'string' ? i.label : i.label.label
    return label.startsWith('^')
  })
}

describe('[[Note#^ block-ref completion', () => {
  before(async () => {
    await activateExtension()
    await writeNoteOnDisk(
      NOTE,
      [
        '# Block refs',
        '',
        '- [ ] Rewire the pump controller #urgent 📅 2026-08-01 ^rewire-the-pump-controller',
        '- [ ] Order replacement seals ^k3f9d1',
        ''
      ].join('\n')
    )
    await writeNoteOnDisk(LINKER, '# Linker\n\n')
    // The suggestions come out of the vault index, so wait for the watcher to
    // pick the new note up rather than racing it.
    await waitFor(async () => (await readNoteOnDisk(NOTE)).includes('^k3f9d1'), {
      message: 'the fixture note to land on disk'
    })
    await waitFor(async () => (await blockRefItems()).length >= 2, {
      timeout: 10000,
      message: 'the index to pick up BlockRefs.md'
    })
  })

  afterEach(async () => {
    await closeAllEditors()
  })

  it('labels each anchor with its id and shows the task text as the detail', async () => {
    const items = await blockRefItems()
    const rewire = items.find((i) => insertTextOf(i).startsWith('^rewire-the-pump-controller'))
    assert.ok(rewire, 'expected a suggestion for the slug anchor')
    // The detail is the task's own prose — no #tag, no 📅 date, no ^anchor.
    assert.strictEqual(rewire.detail, 'Rewire the pump controller')
  })

  it('finds a legacy random anchor by typing the task text, not the id', async () => {
    const items = await blockRefItems()
    const legacy = items.find((i) => insertTextOf(i).startsWith('^k3f9d1'))
    assert.ok(legacy, 'expected a suggestion for the random anchor')
    assert.strictEqual(legacy.detail, 'Order replacement seals')
    // filterText is what VS Code fuzzy-matches, so the task's words must be in it.
    assert.ok(
      legacy.filterText?.includes('Order replacement seals'),
      `filterText should carry the task text, got: ${legacy.filterText}`
    )
  })

  it('inserts an auto-aliased link so it reads as the task', async () => {
    const items = await blockRefItems()
    const rewire = items.find((i) => insertTextOf(i).startsWith('^rewire-the-pump-controller'))
    assert.ok(rewire)
    assert.strictEqual(
      insertTextOf(rewire),
      '^rewire-the-pump-controller|Rewire the pump controller]]'
    )
  })

  it('navigates a slug-anchored link to its note', async () => {
    await vscode.commands.executeCommand(
      'knote.openWikiLink',
      'BlockRefs#^rewire-the-pump-controller'
    )
    await waitFor(
      () => {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
        return input instanceof vscode.TabInputCustom && input.viewType === 'knote.liveEditor'
      },
      { message: 'the slug-anchored link to open the live-preview editor' }
    )
  })
})
