// Weekly notes: open (creating from the configured template if needed) and
// quick capture — append a timestamped bullet to this week's note without
// leaving whatever you're doing.

import * as vscode from 'vscode'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import type { VaultPath } from '@shared/types'
import { joinRel } from '@shared/pathUtils'
import { resolveTarget } from '@shared/wikiResolve'
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

async function openWeeklyNote(): Promise<void> {
  const path = await ensureThisWeekNote()
  await openNoteInLiveEditor(uriForRel(path))
}

/**
 * Append a timestamped bullet to this week's note. Shared by the quick-capture
 * command and the Home dashboard's inline capture (via the `quickCapture` RPC).
 * No-ops on blank text.
 */
export async function captureToWeekNote(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  const path = await ensureThisWeekNote()
  await verifiedEdit.appendToNote(path, `- ${dayjs().format('HH:mm')}  ${trimmed}`)
}

async function quickCapture(): Promise<void> {
  const text = await vscode.window.showInputBox({
    prompt: "Quick capture — appended to this week's note",
    placeHolder: 'What happened?'
  })
  if (text === undefined) return
  await captureToWeekNote(text)
  void vscode.window.setStatusBarMessage('KNote: captured', 2000)
}

export function registerWeeklyNoteCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('knote.openWeeklyNote', openWeeklyNote),
    vscode.commands.registerCommand('knote.quickCapture', quickCapture)
  )
}
