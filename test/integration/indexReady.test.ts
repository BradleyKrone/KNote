// The vault-wide index must be complete and visible to the features built on
// it once activation settles.
//
// Background: the custom editor, sidebar views and providers are all
// registered *before* startEngine builds the index, so anything that asks for
// the index during activation can be handed an empty vault. Webviews used to
// hydrate from exactly that and stay near-empty — `[[` completion showing two
// notes instead of the whole vault — until an indexDelta happened to mention
// each note. getIndexSnapshot now awaits the initial build (engine's
// whenIndexBuilt), and an `indexReady` broadcast re-hydrates any view that got
// in first.
//
// The webview store isn't reachable from here, so what this asserts is the
// host-side half: every note on disk is in the index and offered as a wiki-link
// completion. The startup race itself is timing-dependent and isn't covered.

import * as assert from 'assert'
import * as vscode from 'vscode'
import { activateExtension, closeAllEditors, vaultUri, waitFor, writeNoteOnDisk } from './helpers'

const NOTES = ['IdxOne.md', 'IdxTwo.md', 'IdxSub/IdxThree.md']
const HOST_NOTE = 'IdxHost.md'

async function wikiCompletionLabels(): Promise<string[]> {
  const doc = await vscode.workspace.openTextDocument(vaultUri(HOST_NOTE))
  await vscode.window.showTextDocument(doc)
  // Position right after the `[[` on line 0.
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    doc.uri,
    new vscode.Position(0, 2)
  )
  return (list?.items ?? []).map((i) => (typeof i.label === 'string' ? i.label : i.label.label))
}

describe('index readiness', () => {
  before(async () => {
    await activateExtension()
    await vscode.workspace.fs.createDirectory(vaultUri('IdxSub'))
    for (const note of NOTES) await writeNoteOnDisk(note, `# ${note}\n`)
    await writeNoteOnDisk(HOST_NOTE, '[[\n')
  })

  after(async () => {
    await closeAllEditors()
  })

  it('offers every note in the vault as a wiki-link completion, not just open ones', async () => {
    // Returns null (not []) until ready — waitFor stops on any truthy value,
    // and an empty array is truthy.
    const labels = await waitFor(
      async () => {
        const found = await wikiCompletionLabels()
        return found.includes('IdxThree') ? found : null
      },
      { message: 'the watcher/index to pick up the new notes' }
    )
    assert.ok(labels, 'expected wiki-link completions')

    for (const expected of ['IdxOne', 'IdxTwo', 'IdxThree', 'Sample']) {
      assert.ok(
        labels.includes(expected),
        `expected "${expected}" among wiki-link completions, got: ${labels.join(', ')}`
      )
    }
  })

  it('includes a note in a subfolder that was never opened', async () => {
    // IdxSub/IdxThree.md is only ever written to disk — if the index were
    // limited to notes the editor had touched, this would be missing.
    const labels = await wikiCompletionLabels()
    assert.ok(labels.includes('IdxThree'), `subfolder note missing from: ${labels.join(', ')}`)
  })
})
