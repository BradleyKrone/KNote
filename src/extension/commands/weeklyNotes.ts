// Weekly notes: open (creating from the configured template if needed) and
// quick capture — append a timestamped bullet to this week's note without
// leaving whatever you're doing.

import * as vscode from 'vscode'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import type { VaultPath } from '@shared/types'
import { findWeeklyNote, weeklyPathFor } from '@shared/previousDay'
import { parentOf, titleOf } from '@shared/pathUtils'
import { resolveTarget } from '@shared/wikiResolve'
import { headingSectionEnd } from '@shared/embedSlice'
import { isStaleError } from '@shared/errors'
import { getVaultConfig, setVaultConfig } from '../../core/vaultConfig'
import * as vaultIndex from '../../core/indexer/vaultIndex'
import * as vault from '../../core/vaultService'
import * as verifiedEdit from '../verifiedEdit'
import { currentVaultRoot, notesMap, whenIndexBuilt } from '../engine'
import { folderedFormat, plannedWeeklyMoves } from '../trees/weeklySelectors'
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
    // Opening the "This Week" view during activation lands here before the
    // index is built; asking an empty index "does this week exist?" is how
    // `createFile`'s uniquify used to mint "2026-8-17 1.md" beside the real one.
    await whenIndexBuilt()
    const config = await getVaultConfig()
    const today = dayjs().format('YYYY-MM-DD')
    const path = weeklyPathFor(today, config)
    // The file name alone — with a foldered format, the full formatted string
    // ("2026/10 October/2026-10-12") would land in the template's {{title}}.
    const name = titleOf(path)

    const existing = findWeeklyNote(today, config, notesMap())
    if (existing) return existing
    // On disk but not (yet) indexed — e.g. synced in a moment ago.
    try {
      await vault.readFile(path)
      await vaultIndex.indexFile(path)
      return path
    } catch {
      // Genuinely missing: create it below.
    }

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

const plural = (n: number, one: string, many = one + 's'): string => (n === 1 ? one : many)

/**
 * File every weekly note under the year / month folders its week belongs to
 * (switching a flat `weeklyFormat` to its foldered form first, file naming
 * kept). Each note keeps its file name, so `[[2026-10-12]]` links still
 * resolve; the moves go out as one WorkspaceEdit, so `renameLinks` rewrites
 * any path-qualified `[[Weekly/…]]` link in the same undo step — the same
 * route as a drag in the Files tree.
 *
 * `confirm: false` skips the preview, for the integration harness.
 */
async function organizeWeeklyNotes(options?: { confirm?: boolean }): Promise<void> {
  if (!currentVaultRoot()) {
    void vscode.window.showWarningMessage('KNote: no vault is open in this workspace.')
    return
  }
  await whenIndexBuilt()
  const config = await getVaultConfig()
  const format = folderedFormat(config.weeklyFormat)
  const { moves, blocked } = plannedWeeklyMoves(notesMap().values(), {
    folder: config.weeklyFolder,
    format
  })

  if (moves.length > 0 && options?.confirm !== false) {
    const example = parentOf(moves[0].to)
    const answer = await vscode.window.showInformationMessage(
      `Move ${moves.length} weekly ${plural(moves.length, 'note')} into year / month folders?`,
      {
        modal: true,
        detail:
          `e.g. ${moves[0].from} → ${example}/. File names stay the same, so links keep working.` +
          (format !== config.weeklyFormat
            ? `\n\nThe weekly filename format becomes "${format}", so new weekly notes are filed the same way.`
            : '')
      },
      'Organize'
    )
    if (answer !== 'Organize') return
  }

  if (format !== config.weeklyFormat) {
    await setVaultConfig({ ...config, weeklyFormat: format })
  }

  if (moves.length > 0) {
    const edit = new vscode.WorkspaceEdit()
    for (const move of moves) edit.renameFile(uriForRel(move.from), uriForRel(move.to))
    await vscode.workspace.applyEdit(edit)
  }

  const moved =
    moves.length > 0
      ? `KNote: moved ${moves.length} weekly ${plural(moves.length, 'note')} into year / month folders.`
      : 'KNote: weekly notes are already organized.'
  void vscode.window.showInformationMessage(
    blocked.length > 0
      ? `${moved} Skipped ${blocked.length} whose destination already has a note of the same name: ${blocked.join(', ')}`
      : moved
  )
}

const ORGANIZE_PROMPTED = 'knote.weeklyOrganizePrompted'

/**
 * Once per workspace: if weekly notes sit outside the folders their format
 * names (a vault from before foldered weekly notes), offer to organize them.
 * Nothing moves without a click.
 */
export async function offerWeeklyOrganize(context: vscode.ExtensionContext): Promise<void> {
  if (context.workspaceState.get<boolean>(ORGANIZE_PROMPTED)) return
  await whenIndexBuilt()
  if (!currentVaultRoot()) return
  const config = await getVaultConfig()
  const { moves } = plannedWeeklyMoves(notesMap().values(), {
    folder: config.weeklyFolder,
    format: folderedFormat(config.weeklyFormat)
  })
  if (moves.length === 0) return
  const answer = await vscode.window.showInformationMessage(
    `KNote: ${moves.length} weekly ${plural(moves.length, 'note')} could be filed into year / month folders to keep ${config.weeklyFolder || 'the weekly folder'} short.`,
    'Organize',
    'Not now',
    "Don't ask again"
  )
  if (answer === "Don't ask again") await context.workspaceState.update(ORGANIZE_PROMPTED, true)
  if (answer === 'Organize') {
    await context.workspaceState.update(ORGANIZE_PROMPTED, true)
    await organizeWeeklyNotes({ confirm: false })
  }
}

export function registerWeeklyNoteCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('knote.openWeeklyNote', openWeeklyNote),
    vscode.commands.registerCommand(
      'knote.organizeWeeklyNotes',
      (options?: { confirm?: boolean }) => organizeWeeklyNotes(options)
    ),
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
