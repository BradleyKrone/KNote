import { registerCommand } from './registry'
import { openThisWeekNote } from './weeklyNotes'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { useVaultStore } from '@/stores/vaultStore'
import { formatActive, insertMilestoneAtCursor } from '@/editor/formatting'

/** Registered once at app start; the palette lists whatever is here. */
export function registerCoreCommands(): void {
  registerCommand({
    id: 'weekly-note',
    name: "Open this week's note",
    run: () => openThisWeekNote()
  })

  registerCommand({
    id: 'insert-template',
    name: 'Insert template…',
    run: () => useUiStore.getState().setTemplatePickerOpen(true)
  })

  registerCommand({
    id: 'new-note',
    name: 'Create new note',
    run: async () => {
      const created = await window.knote.createFile('Untitled.md', '')
      await useVaultStore.getState().refreshTree()
      await useWorkspaceStore.getState().openFile(created)
    }
  })

  registerCommand({
    id: 'quick-switcher',
    name: 'Open quick switcher',
    hotkey: 'Ctrl+O',
    run: () => useUiStore.getState().setQuickSwitcherOpen(true)
  })

  registerCommand({
    id: 'search-vault',
    name: 'Search in all files',
    run: () => useUiStore.getState().searchFor('')
  })

  registerCommand({
    id: 'mode-live',
    name: 'Editing mode: Live preview',
    run: () => useWorkspaceStore.getState().setMode('live')
  })

  registerCommand({
    id: 'mode-source',
    name: 'Editing mode: Source',
    run: () => useWorkspaceStore.getState().setMode('source')
  })

  registerCommand({
    id: 'mode-reading',
    name: 'Reading mode',
    hotkey: 'Ctrl+E',
    run: () => {
      const ws = useWorkspaceStore.getState()
      ws.setMode(ws.mode === 'reading' ? 'live' : 'reading')
    }
  })

  registerCommand({
    id: 'toggle-theme',
    name: 'Toggle light/dark theme',
    run: () => useSettingsStore.getState().toggleTheme()
  })

  registerCommand({
    id: 'toggle-right-panel',
    name: 'Toggle right panel (backlinks & properties)',
    run: () => useUiStore.getState().toggleRightPanel()
  })

  registerCommand({
    id: 'open-settings',
    name: 'Open settings',
    run: () => useSettingsStore.getState().setSettingsOpen(true)
  })

  registerCommand({
    id: 'open-board',
    name: 'Open Kanban board (all notes)',
    run: () => useUiStore.getState().openBoard({ kind: 'global' })
  })

  registerCommand({
    id: 'open-board-note',
    name: 'Open Kanban board for current note',
    run: () => {
      const note = useWorkspaceStore.getState().note
      if (note) useUiStore.getState().openBoard({ kind: 'note', path: note.path })
    }
  })

  registerCommand({
    id: 'open-timeline',
    name: 'Open timeline',
    run: () => useUiStore.getState().setTimelineOpen(true)
  })

  registerCommand({
    id: 'insert-milestone',
    name: 'Insert timeline milestone',
    run: () => insertMilestoneAtCursor(false)
  })

  registerCommand({
    id: 'insert-milestone-important',
    name: 'Insert important timeline milestone',
    run: () => insertMilestoneAtCursor(true)
  })

  registerCommand({
    id: 'open-vault',
    name: 'Open another vault…',
    run: async () => {
      const info = await window.knote.pickVault()
      if (!info) return
      useWorkspaceStore.getState().closeFile()
      useUiStore.getState().setBoardOpen(false)
      useVaultStore.getState().setVault(info)
    }
  })

  registerCommand({
    id: 'format-bold',
    name: 'Format: Toggle bold',
    hotkey: 'Ctrl+B',
    run: () => formatActive('bold')
  })

  registerCommand({
    id: 'format-italic',
    name: 'Format: Toggle italic',
    hotkey: 'Ctrl+I',
    run: () => formatActive('italic')
  })

  registerCommand({
    id: 'format-strikethrough',
    name: 'Format: Toggle strikethrough',
    hotkey: 'Ctrl+Shift+X',
    run: () => formatActive('strike')
  })

  registerCommand({
    id: 'format-code',
    name: 'Format: Toggle inline code',
    hotkey: 'Ctrl+`',
    run: () => formatActive('code')
  })
}
