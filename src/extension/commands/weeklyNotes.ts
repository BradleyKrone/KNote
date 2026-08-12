// Weekly notes: open (creating from the configured template if needed) and
// quick capture — append a timestamped bullet to this week's note without
// leaving whatever you're doing.

import * as vscode from 'vscode'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import type { VaultPath } from '@shared/types'
import { joinRel } from '@shared/pathUtils'
import { resolveTarget } from '@shared/wikiResolve'
import { headingSectionEnd } from '@shared/embedSlice'
import { isStaleError } from '@shared/errors'
import { getVaultConfig } from '../../core/vaultConfig'
import * as vaultIndex from '../../core/indexer/vaultIndex'
import * as vault from '../../core/vaultService'
import * as verifiedEdit from '../verifiedEdit'
import { notesMap } from '../engine'
import { uriForRel } from '../paths'
import { fillTemplate, readTemplateContent } from './templates'
import { openNoteInLiveEditor } from '../views/liveEditorProvider'

dayjs.extend(isoWeek)

let pendingWeekNote: Promise<VaultPath> | null = null

/**
 * Resolve this week's note, creating it from the configured template if
 * needed, without opening it. Memoized behind an in-flight promise so
 * concurrent callers (e.g. rapid quick-captures) can't race and create
 * duplicate weekly notes.
 */
export async function ensureThisWeekNote(): Promise<VaultPath> {
  if (pendingWeekNote) return pendingWeekNote
  pendingWeekNote = (async () => {
    const config = await getVaultConfig()
    const name = dayjs().startOf('isoWeek').format(config.weeklyFormat)
    const path = joinRel(config.weeklyFolder, name + '.md')

    const existing = resolveTarget(path, notesMap())
    if (existing) return existing

    let content = ''
    if (config.weeklyTemplate) {
      const templatePath = resolveTarget(config.weeklyTemplate, notesMap())
      if (templatePath) {
        content = fillTemplate(await readTemplateContent(templatePath), name)
      }
    }
    const created = await vault.createFile(path, content)
    await vaultIndex.indexFile(created)
    return created
  })()
  try {
    return await pendingWeekNote
  } finally {
    pendingWeekNote = null
  }
}

/**
 * Append `text` as a new line at the end of `path`'s "Tasks" section (right
 * before the next same-or-higher-level heading, or end of file if "Tasks" is
 * the last section) rather than at the very end of the note — how the
 * board's "Add card" lands new cards in the weekly note without dropping
 * them under whatever section happens to come last (e.g. a day-by-day
 * journal). Falls back to a plain end-of-file append when the note has no
 * "Tasks" heading, or when the section's last line raced with another edit
 * between reading it here and writing.
 */
export async function appendUnderTasksHeading(path: VaultPath, text: string): Promise<void> {
  const meta = vaultIndex.getSnapshot().find((m) => m.path === path)
  const heading = meta?.headings.find((h) => h.text.trim().toLowerCase() === 'tasks')
  if (meta && heading) {
    let content = vaultIndex.getContent(path)
    if (content === undefined) {
      try {
        content = (await vault.readFile(path)).content
      } catch {
        content = undefined
      }
    }
    if (content !== undefined) {
      const lines = content.split(/\r?\n/)
      const end = headingSectionEnd(meta, heading.line, heading.level, lines.length)
      let anchor = end - 1
      while (anchor > heading.line && lines[anchor].trim() === '') anchor--
      try {
        await verifiedEdit.insertLine(path, anchor, lines[anchor], text)
        return
      } catch (err) {
        if (!isStaleError(err)) throw err
      }
    }
  }
  await verifiedEdit.appendToNote(path, text)
}

/**
 * Ensure this week's note exists and append `text` under its "Tasks"
 * heading (see `appendUnderTasksHeading`), returning the note's path.
 */
export async function appendToWeeklyNoteTasks(text: string): Promise<VaultPath> {
  const path = await ensureThisWeekNote()
  await appendUnderTasksHeading(path, text)
  return path
}

async function openWeeklyNote(): Promise<void> {
  const path = await ensureThisWeekNote()
  await openNoteInLiveEditor(uriForRel(path))
}

async function quickCapture(): Promise<void> {
  const text = await vscode.window.showInputBox({
    prompt: "Quick capture — appended to this week's note",
    placeHolder: 'What happened?'
  })
  if (text === undefined) return
  const trimmed = text.trim()
  if (!trimmed) return
  const path = await ensureThisWeekNote()
  await verifiedEdit.appendToNote(path, `- ${dayjs().format('HH:mm')}  ${trimmed}`)
  void vscode.window.setStatusBarMessage('KNote: captured', 2000)
}

export function registerWeeklyNoteCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('knote.openWeeklyNote', openWeeklyNote),
    vscode.commands.registerCommand('knote.quickCapture', quickCapture),
    // The board's "Add card" (global/folder scope), as a command. Deliberately
    // not contributed to package.json — same reasoning as `knote.setTaskNote`:
    // it exists so the integration harness can drive this RPC-only write,
    // which it cannot reach through the board webview.
    vscode.commands.registerCommand('knote.appendToWeeklyNoteTasks', (text: string) =>
      appendToWeeklyNoteTasks(text)
    ),
    // Same reasoning, but bypassing `ensureThisWeekNote`'s dynamic "this
    // week's filename" so a test can target a note it wrote itself.
    vscode.commands.registerCommand(
      'knote.appendUnderTasksHeading',
      (path: VaultPath, text: string) => appendUnderTasksHeading(path, text)
    )
  )
}
