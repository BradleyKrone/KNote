import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import type { VaultPath } from '@shared/types'
import { joinRel, samePath, titleOf } from '@shared/pathUtils'
import { useSettingsStore } from '@/stores/settingsStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { resolveTarget } from '@/stores/indexStore'
import { getActiveEditorView } from '@/editor/activeView'

dayjs.extend(isoWeek)

export function fillTemplate(template: string, title: string): string {
  return template
    .replace(/\{\{date\}\}/g, dayjs().format('YYYY-MM-DD'))
    .replace(/\{\{time\}\}/g, dayjs().format('HH:mm'))
    .replace(/\{\{title\}\}/g, title)
}

let pendingWeekNote: Promise<VaultPath> | null = null

/**
 * Resolve this week's note, creating it from the configured template if
 * needed, without opening it. Memoized behind an in-flight promise so
 * concurrent callers (e.g. rapid quick-captures) can't race and create
 * duplicate weekly notes.
 */
async function ensureThisWeekNote(): Promise<VaultPath> {
  if (pendingWeekNote) return pendingWeekNote
  pendingWeekNote = (async () => {
    // Config lives on disk (.knote/config.json) and may have been edited
    // externally — read it fresh rather than trusting the cached copy
    await useSettingsStore.getState().loadVaultConfig()
    const config = useSettingsStore.getState().vaultConfig
    const name = dayjs().startOf('isoWeek').format(config.weeklyFormat)
    const path = joinRel(config.weeklyFolder, name + '.md')

    const existing = resolveTarget(path)
    if (existing) return existing

    let content = ''
    if (config.weeklyTemplate) {
      const templatePath = resolveTarget(config.weeklyTemplate)
      if (templatePath) {
        const t = await window.knote.readFile(templatePath)
        content = fillTemplate(t.content, name)
      }
    }
    const created = await window.knote.createFile(path, content)
    await useVaultStore.getState().refreshTree()
    return created
  })()
  try {
    return await pendingWeekNote
  } finally {
    pendingWeekNote = null
  }
}

/** Open this week's note, creating it from the configured template if needed. */
export async function openThisWeekNote(): Promise<void> {
  const path = await ensureThisWeekNote()
  await useWorkspaceStore.getState().openFile(path)
}

/** Append a timestamped bullet to this week's note without navigating away. */
export async function quickCapture(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  const path = await ensureThisWeekNote()
  const line = `- ${dayjs().format('HH:mm')}  ${trimmed}`

  const ws = useWorkspaceStore.getState()
  const view = getActiveEditorView()
  if (view && ws.note && samePath(ws.note.path, path)) {
    const doc = view.state.doc
    const needsNewline = doc.length > 0 && doc.sliceString(doc.length - 1) !== '\n'
    view.dispatch({
      changes: { from: doc.length, insert: (needsNewline ? '\n' : '') + line + '\n' },
      userEvent: 'input.knote.quickCapture'
    })
    view.focus()
    return
  }
  await window.knote.appendToNote(path, line)
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
