import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import type { VaultConfig } from '@shared/types'
import { useSettingsStore } from '@/stores/settingsStore'

export function SettingsModal(): React.JSX.Element | null {
  const open = useSettingsStore((s) => s.settingsOpen)
  const setOpen = useSettingsStore((s) => s.setSettingsOpen)
  const vaultConfig = useSettingsStore((s) => s.vaultConfig)
  const saveVaultConfig = useSettingsStore((s) => s.saveVaultConfig)
  const [draft, setDraft] = useState<VaultConfig>(vaultConfig)

  // On open: show the cached config immediately, then refresh once from
  // disk (it may have been edited outside KNote). Never reset the draft
  // after that — it would wipe the user's in-progress edits.
  useEffect(() => {
    if (!open) return
    setDraft(useSettingsStore.getState().vaultConfig)
    let cancelled = false
    void useSettingsStore
      .getState()
      .loadVaultConfig()
      .then(() => {
        if (!cancelled) setDraft(useSettingsStore.getState().vaultConfig)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  const moveColumn = (i: number, dir: -1 | 1): void => {
    const j = i + dir
    if (j < 0 || j >= draft.columns.length) return
    const columns = [...draft.columns]
    ;[columns[i], columns[j]] = [columns[j], columns[i]]
    setDraft({ ...draft, columns })
  }

  const commit = (): void => {
    setOpen(false)
    void saveVaultConfig({
      ...draft,
      columns: draft.columns.filter((c) => c.name.trim() !== '' && c.char.length === 1)
    })
  }

  const field = (
    label: string,
    key: keyof Omit<VaultConfig, 'columns'>,
    hint?: string
  ): React.JSX.Element => (
    <div className="settings-field">
      <label>
        <span className="settings-label">{label}</span>
        {hint && <span className="settings-hint">{hint}</span>}
      </label>
      <input
        className="panel-input"
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </div>
  )

  return (
    <div className="modal-overlay" onMouseDown={commit}>
      <div className="modal-panel settings-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-title">
          Settings
          <button className="icon-btn" onClick={commit}>
            <X size={16} />
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-section">Weekly notes</div>
          {field('Folder', 'weeklyFolder')}
          {field('Filename format', 'weeklyFormat', 'dayjs tokens, e.g. GGGG-[W]WW')}
          {field('Template note', 'weeklyTemplate', 'note name or path, empty = none')}

          <div className="settings-section">Templates</div>
          {field('Templates folder', 'templatesFolder')}

          <div className="settings-section">Kanban board</div>
          {field('Inbox note', 'inboxNote', 'receives cards added on the global board')}
          <div className="settings-field">
            <label>
              <span className="settings-label">Columns</span>
              <span className="settings-hint">status char ↔ column, in board order</span>
            </label>
            {draft.columns.map((col, i) => (
              <div key={i} className="settings-column-row">
                <button
                  className="icon-btn"
                  title="Move up"
                  disabled={i === 0}
                  onClick={() => moveColumn(i, -1)}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Move down"
                  disabled={i === draft.columns.length - 1}
                  onClick={() => moveColumn(i, 1)}
                >
                  <ArrowDown size={13} />
                </button>
                <input
                  className="panel-input small"
                  value={col.name}
                  placeholder="Column name"
                  onChange={(e) => {
                    const columns = [...draft.columns]
                    columns[i] = { ...col, name: e.target.value }
                    setDraft({ ...draft, columns })
                  }}
                />
                <input
                  className="panel-input small char-input"
                  value={col.char === ' ' ? '␣' : col.char}
                  maxLength={1}
                  onChange={(e) => {
                    const raw = e.target.value
                    const char = raw === '␣' || raw === '' ? ' ' : raw.slice(-1)
                    const columns = [...draft.columns]
                    columns[i] = { ...col, char }
                    setDraft({ ...draft, columns })
                  }}
                />
                <button
                  className="icon-btn"
                  title="Remove column"
                  onClick={() =>
                    setDraft({ ...draft, columns: draft.columns.filter((_, j) => j !== i) })
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <button
              className="icon-btn add-column-btn"
              title="Add column"
              onClick={() =>
                setDraft({ ...draft, columns: [...draft.columns, { name: '', char: '?' }] })
              }
            >
              <Plus size={14} /> Add column
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
