// "KNote: Organize Weekly Notes into Folders" files flat weekly notes under
// year / month folders, in a real host: the moves ride the workspace rename
// pipeline (so path-qualified [[links]] are rewritten), the vault's format is
// switched to its foldered form, and "Open This Week's Note" afterwards finds
// the moved note instead of minting a duplicate beside it.

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

const CONFIG = '.knote/config.json'
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

/** This ISO week's Monday as the default `YYYY-M-D` name, and its `YYYY/MM MMMM` folder. */
function thisWeek(): { name: string; folder: string } {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return {
    name: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
    folder: `${d.getFullYear()}/${month} ${MONTHS[d.getMonth()]}`
  }
}

/**
 * Create a note and guarantee KNote has indexed it without racing the watcher:
 * an editor save routes through docSync, which reindexes synchronously.
 */
async function createIndexedNote(relPath: string, content: string): Promise<void> {
  await writeNoteOnDisk(relPath, '')
  const doc = await vscode.workspace.openTextDocument(vaultUri(relPath))
  const editor = await vscode.window.showTextDocument(doc)
  await editor.edit((b) => b.insert(new vscode.Position(0, 0), content))
  await doc.save()
}

async function exists(rel: string): Promise<boolean> {
  try {
    await fs.stat(vaultUri(rel).fsPath)
    return true
  } catch {
    return false
  }
}

describe('organize weekly notes into year / month folders', () => {
  let originalConfig = ''
  const week = thisWeek()

  before(async () => {
    await activateExtension()
    originalConfig = await readNoteOnDisk(CONFIG)
  })

  after(async () => {
    await closeAllEditors()
    await writeNoteOnDisk(CONFIG, originalConfig)
    await fs.rm(vaultUri('Weekly').fsPath, { recursive: true, force: true })
    await fs.rm(vaultUri('WeeklyLinker.md').fsPath, { force: true })
  })

  it('moves flat notes, rewrites links, switches the format, and reuses the moved note', async () => {
    await fs.rm(vaultUri('Weekly').fsPath, { recursive: true, force: true })
    await fs.mkdir(vaultUri('Weekly').fsPath, { recursive: true })
    // The move plan and the link rewrite both read the index.
    await createIndexedNote('Weekly/2026-9-28.md', '# Sept\n')
    await createIndexedNote('Weekly/2026-8-17 1.md', '# Aug copy\n')
    await createIndexedNote(`Weekly/${week.name}.md`, '# This week\n')
    await createIndexedNote('WeeklyLinker.md', 'See [[Weekly/2026-9-28]].\n')
    await closeAllEditors()

    await vscode.commands.executeCommand('knote.organizeWeeklyNotes', { confirm: false })

    await waitFor(async () => exists('Weekly/2026/09 September/2026-9-28.md'), {
      message: 'September note moved'
    })
    assert.ok(await exists('Weekly/2026/08 August/2026-8-17 1.md'), 'duplicate copy moved too')
    assert.ok(await exists(`Weekly/${week.folder}/${week.name}.md`), "this week's note moved")
    assert.ok(!(await exists('Weekly/2026-9-28.md')), 'flat copy is gone')

    const linker = await waitFor(
      async () => {
        const text = await readNoteOnDisk('WeeklyLinker.md')
        return text.includes('[[Weekly/2026-9-28]]') ? '' : text
      },
      { message: 'path-qualified link rewritten' }
    )
    assert.ok(linker.includes('2026-9-28'), `link still names the note: ${linker}`)

    const config = JSON.parse(await readNoteOnDisk(CONFIG))
    assert.strictEqual(config.weeklyFormat, 'YYYY/MM MMMM/YYYY-M-D')

    // This week's note now lives in its folder: opening it must reuse it.
    await vscode.commands.executeCommand('knote.openWeeklyNote')
    const folder = await fs.readdir(vaultUri(`Weekly/${week.folder}`).fsPath)
    assert.deepStrictEqual(
      folder.filter((f) => f.startsWith(week.name)),
      [`${week.name}.md`],
      'no duplicate of this week was created'
    )
    assert.ok(!(await exists(`Weekly/${week.name}.md`)), 'nothing recreated at the flat path')
  })
})
