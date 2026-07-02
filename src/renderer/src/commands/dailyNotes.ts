import dayjs from 'dayjs'
import { joinRel, titleOf } from '@shared/pathUtils'
import { useSettingsStore } from '@/stores/settingsStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { resolveTarget } from '@/stores/indexStore'

export function fillTemplate(template: string, title: string): string {
  return template
    .replace(/\{\{date\}\}/g, dayjs().format('YYYY-MM-DD'))
    .replace(/\{\{time\}\}/g, dayjs().format('HH:mm'))
    .replace(/\{\{title\}\}/g, title)
}

/** Open today's daily note, creating it from the configured template if needed. */
export async function openTodayNote(): Promise<void> {
  // Config lives on disk (.knote/config.json) and may have been edited
  // externally — read it fresh rather than trusting the cached copy
  await useSettingsStore.getState().loadVaultConfig()
  const config = useSettingsStore.getState().vaultConfig
  const name = dayjs().format(config.dailyFormat)
  const path = joinRel(config.dailyFolder, name + '.md')

  const existing = resolveTarget(path)
  if (existing) {
    await useWorkspaceStore.getState().openFile(existing)
    return
  }

  let content = ''
  if (config.dailyTemplate) {
    const templatePath = resolveTarget(config.dailyTemplate)
    if (templatePath) {
      const t = await window.knote.readFile(templatePath)
      content = fillTemplate(t.content, name)
    }
  }
  const created = await window.knote.createFile(path, content)
  await useVaultStore.getState().refreshTree()
  await useWorkspaceStore.getState().openFile(created)
}

/** Insert a template's contents (placeholders stamped) at the cursor. */
export async function insertTemplate(templatePath: string): Promise<void> {
  const { getActiveEditorView } = await import('@/editor/activeView')
  const view = getActiveEditorView()
  const note = useWorkspaceStore.getState().note
  if (!view || !note) return
  const t = await window.knote.readFile(templatePath)
  const text = fillTemplate(t.content, titleOf(note.path))
  view.dispatch({
    changes: { from: view.state.selection.main.head, insert: text },
    userEvent: 'input.knote.template'
  })
  view.focus()
}
