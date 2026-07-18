// Template insertion + the shared placeholder expansion ({{date}}, {{time}},
// {{title}}, {{weekdays}}) used by both "Insert template" and weekly notes.

import * as vscode from 'vscode'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import { isInside, titleOf } from '@shared/pathUtils'
import { getVaultConfig } from '../../core/vaultConfig'
import * as vaultIndex from '../../core/indexer/vaultIndex'
import * as vault from '../../core/vaultService'
import { vaultNoteRel } from '../paths'

dayjs.extend(isoWeek)

/**
 * The seven days of the current ISO week (Mon–Sun) as `###` headings,
 * separated by blank lines so there's room to type each day's notes.
 */
function weekdaysBlock(): string {
  const start = dayjs().startOf('isoWeek')
  return Array.from({ length: 7 }, (_, i) => {
    const day = start.add(i, 'day')
    return `### ${day.format('M/D/YYYY')} (${day.format('dddd')})`
  }).join('\n\n')
}

export function fillTemplate(template: string, title: string): string {
  return template
    .replace(/\{\{date\}\}/g, dayjs().format('YYYY-MM-DD'))
    .replace(/\{\{time\}\}/g, dayjs().format('HH:mm'))
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{weekdays\}\}/g, weekdaysBlock())
}

export async function readTemplateContent(templatePath: string): Promise<string> {
  const cached = vaultIndex.getContent(templatePath)
  if (cached !== undefined) return cached
  return (await vault.readFile(templatePath)).content
}

async function insertTemplate(): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) return
  const rel = vaultNoteRel(editor.document)
  if (rel === null) {
    void vscode.window.showWarningMessage('KNote: the active editor is not a vault note.')
    return
  }
  const config = await getVaultConfig()
  const templates = vaultIndex
    .getSnapshot()
    .filter((m) => isInside(m.path, config.templatesFolder))
    .sort((a, b) => a.title.localeCompare(b.title))
  if (templates.length === 0) {
    void vscode.window.showInformationMessage(
      `KNote: no templates found in "${config.templatesFolder}".`
    )
    return
  }
  const picked = await vscode.window.showQuickPick(
    templates.map((t) => ({ label: t.title, description: t.path })),
    { placeHolder: 'Insert template' }
  )
  if (!picked) return
  const content = await readTemplateContent(picked.description)
  const text = fillTemplate(content, titleOf(rel))
  await editor.edit((b) => b.insert(editor.selection.active, text))
}

export function registerTemplateCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('knote.insertTemplate', insertTemplate)
  )
}
