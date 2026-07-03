import { useEffect, useMemo, useRef, useState } from 'react'
import { isInside } from '@shared/pathUtils'
import { useIndexStore } from '@/stores/indexStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { insertTemplate } from '@/commands/weeklyNotes'

export function TemplatePicker(): React.JSX.Element | null {
  const open = useUiStore((s) => s.templatePickerOpen)
  const setOpen = useUiStore((s) => s.setTemplatePickerOpen)
  const notes = useIndexStore((s) => s.notes)
  const templatesFolder = useSettingsStore((s) => s.vaultConfig.templatesFolder)
  const [selected, setSelected] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const templates = useMemo(() => {
    return [...notes.values()]
      .filter((m) => isInside(m.path, templatesFolder))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [notes, templatesFolder])

  useEffect(() => {
    if (open) {
      setSelected(0)
      setTimeout(() => ref.current?.focus(), 0)
    }
  }, [open])

  if (!open) return null

  const pick = (path: string): void => {
    setOpen(false)
    void insertTemplate(path)
  }

  return (
    <div className="modal-overlay" onMouseDown={() => setOpen(false)}>
      <div
        ref={ref}
        tabIndex={-1}
        className="modal-panel"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          else if (e.key === 'ArrowDown') setSelected((s) => Math.min(s + 1, templates.length - 1))
          else if (e.key === 'ArrowUp') setSelected((s) => Math.max(s - 1, 0))
          else if (e.key === 'Enter' && templates[selected]) pick(templates[selected].path)
        }}
      >
        <div className="modal-input" style={{ cursor: 'default' }}>
          Insert template {templates.length === 0 ? `— no notes in "${templatesFolder}/"` : ''}
        </div>
        <div className="modal-results">
          {templates.map((t, i) => (
            <div
              key={t.path}
              className={`modal-result${i === selected ? ' selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => pick(t.path)}
            >
              <span className="modal-result-label">{t.title}</span>
              <span className="modal-result-detail">{t.path}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
