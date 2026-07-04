import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Calendar,
  FileText,
  HardDrive,
  Image,
  Info,
  Kanban,
  Plus,
  ScrollText,
  X
} from 'lucide-react'
import type { VaultConfig } from '@shared/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWelcomeStore } from '@/stores/welcomeStore'
import { useReleaseNotesStore } from '@/stores/releaseNotesStore'

type SettingsCategory = 'general' | 'weekly' | 'templates' | 'attachments' | 'kanban' | 'machines'

const CATEGORIES: { id: SettingsCategory; label: string; icon: typeof Info }[] = [
  { id: 'general', label: 'General', icon: Info },
  { id: 'weekly', label: 'Weekly notes', icon: Calendar },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'attachments', label: 'Attachments', icon: Image },
  { id: 'kanban', label: 'Kanban board', icon: Kanban },
  { id: 'machines', label: 'Machines', icon: HardDrive }
]

export function SettingsModal(): React.JSX.Element | null {
  const open = useSettingsStore((s) => s.settingsOpen)
  const setOpen = useSettingsStore((s) => s.setSettingsOpen)
  const vaultConfig = useSettingsStore((s) => s.vaultConfig)
  const saveVaultConfig = useSettingsStore((s) => s.saveVaultConfig)
  const [draft, setDraft] = useState<VaultConfig>(vaultConfig)
  const [category, setCategory] = useState<SettingsCategory>('general')
  // Raw, as-typed text for each machine's attributes field. Kept separate from
  // draft.machines[i].attributes (a string[]) so a keystroke never round-trips
  // through split→join — that round-trip would silently eat a trailing space
  // the instant it's typed, before the next word can be entered.
  const [machineAttrText, setMachineAttrText] = useState<string[]>(
    vaultConfig.machines.map((m) => m.attributes.join(' '))
  )

  // On open: show the cached config immediately, then refresh once from
  // disk (it may have been edited outside KNote). Never reset the draft
  // after that — it would wipe the user's in-progress edits.
  useEffect(() => {
    if (!open) return
    const cached = useSettingsStore.getState().vaultConfig
    setDraft(cached)
    setMachineAttrText(cached.machines.map((m) => m.attributes.join(' ')))
    let cancelled = false
    void useSettingsStore
      .getState()
      .loadVaultConfig()
      .then(() => {
        if (cancelled) return
        const loaded = useSettingsStore.getState().vaultConfig
        setDraft(loaded)
        setMachineAttrText(loaded.machines.map((m) => m.attributes.join(' ')))
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
      columns: draft.columns.filter((c) => c.name.trim() !== '' && c.char.length === 1),
      machines: draft.machines
        .map((m, i) => ({
          ...m,
          serial: m.serial.trim(),
          attributes: (machineAttrText[i] ?? '').trim().split(/\s+/).filter(Boolean)
        }))
        .filter((m) => m.serial !== '')
    })
  }

  const field = (
    label: string,
    key: keyof Omit<VaultConfig, 'columns' | 'machines'>,
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
          <span>Settings</span>
          <button className="icon-btn" onClick={commit}>
            <X size={16} />
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-sidebar">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                className={
                  'settings-nav-item' + (category === cat.id ? ' settings-nav-item-active' : '')
                }
                onClick={() => setCategory(cat.id)}
              >
                <cat.icon size={14} /> {cat.label}
              </button>
            ))}
          </div>

          <div className="settings-content">
            {category === 'general' && (
              <>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-title">Version</div>
                    <div className="settings-row-desc">v{__APP_VERSION__}</div>
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-title">Welcome & feature guide</div>
                    <div className="settings-row-desc">Tour of what KNote can do</div>
                  </div>
                  <button
                    className="icon-btn settings-row-btn"
                    onClick={() => {
                      setOpen(false)
                      useWelcomeStore.getState().setOpen(true)
                    }}
                  >
                    <BookOpen size={14} /> Open
                  </button>
                </div>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-title">Release notes</div>
                    <div className="settings-row-desc">What changed in recent versions</div>
                  </div>
                  <button
                    className="icon-btn settings-row-btn"
                    onClick={() => {
                      setOpen(false)
                      useReleaseNotesStore.getState().setOpen(true)
                    }}
                  >
                    <ScrollText size={14} /> Open
                  </button>
                </div>
              </>
            )}

            {category === 'weekly' && (
              <>
                {field('Folder', 'weeklyFolder')}
                {field(
                  'Filename format',
                  'weeklyFormat',
                  'dayjs tokens applied to the Monday of the week, e.g. YYYY-M-D'
                )}
                {field('Template note', 'weeklyTemplate', 'note name or path, empty = none')}
              </>
            )}

            {category === 'templates' && (
              <>
                {field(
                  'Templates folder',
                  'templatesFolder',
                  'can be a nested path, e.g. "Knote Resources/Templates"'
                )}
              </>
            )}

            {category === 'attachments' && (
              <>
                {field(
                  'Attachments folder',
                  'attachmentsFolder',
                  'where pasted images are saved; can be a nested path'
                )}
              </>
            )}

            {category === 'kanban' && (
              <>
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
              </>
            )}

            {category === 'machines' && (
              <div className="settings-field">
                <label>
                  <span className="settings-label">Registered machines</span>
                  <span className="settings-hint">
                    serial number → model + config attributes, for the Machine Log
                  </span>
                </label>
                {draft.machines.map((m, i) => (
                  <div key={i} className="settings-machine-row">
                    <input
                      className="panel-input small"
                      value={m.serial}
                      placeholder="Serial (e.g. Z6A00101)"
                      onChange={(e) => {
                        const machines = [...draft.machines]
                        machines[i] = { ...m, serial: e.target.value }
                        setDraft({ ...draft, machines })
                      }}
                    />
                    <input
                      className="panel-input small"
                      value={m.model}
                      placeholder="Model (e.g. D6)"
                      onChange={(e) => {
                        const machines = [...draft.machines]
                        machines[i] = { ...m, model: e.target.value }
                        setDraft({ ...draft, machines })
                      }}
                    />
                    <input
                      className="panel-input small"
                      value={machineAttrText[i] ?? ''}
                      placeholder="Attributes (e.g. LGP VP EX)"
                      onChange={(e) => {
                        const next = [...machineAttrText]
                        next[i] = e.target.value
                        setMachineAttrText(next)
                      }}
                    />
                    <button
                      className="icon-btn"
                      title="Remove machine"
                      onClick={() => {
                        setDraft({ ...draft, machines: draft.machines.filter((_, j) => j !== i) })
                        setMachineAttrText(machineAttrText.filter((_, j) => j !== i))
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button
                  className="icon-btn add-column-btn"
                  title="Add machine"
                  onClick={() => {
                    setDraft({
                      ...draft,
                      machines: [...draft.machines, { serial: '', model: '', attributes: [] }]
                    })
                    setMachineAttrText([...machineAttrText, ''])
                  }}
                >
                  <Plus size={14} /> Add machine
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
