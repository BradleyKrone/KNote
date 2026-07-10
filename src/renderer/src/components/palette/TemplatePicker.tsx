import { useMemo } from 'react'
import { isInside } from '@shared/pathUtils'
import { useIndexStore } from '@/stores/indexStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { insertTemplate } from '@/commands/weeklyNotes'
import { ListModal } from './ListModal'

export function TemplatePicker(): React.JSX.Element | null {
  const open = useUiStore((s) => s.templatePickerOpen)
  const setOpen = useUiStore((s) => s.setTemplatePickerOpen)
  const notes = useIndexStore((s) => s.notes)
  const templatesFolder = useSettingsStore((s) => s.vaultConfig.templatesFolder)

  const templates = useMemo(() => {
    return [...notes.values()]
      .filter((m) => isInside(m.path, templatesFolder))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [notes, templatesFolder])

  if (!open) return null

  return (
    <ListModal
      rows={templates.map((t) => ({ key: t.path, label: t.title, detail: t.path }))}
      onClose={() => setOpen(false)}
      onPick={(i) => {
        setOpen(false)
        void insertTemplate(templates[i].path)
      }}
      header={`Insert template ${templates.length === 0 ? `— no notes in "${templatesFolder}/"` : ''}`}
    />
  )
}
