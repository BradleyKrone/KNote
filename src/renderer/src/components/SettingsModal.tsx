import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Bot,
  Calendar,
  Eye,
  EyeOff,
  FileText,
  HardDrive,
  Hash,
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
import { openCopilotInstructions } from '@/commands/copilotInstructions'
import { useIndexStore, tagCounts } from '@/stores/indexStore'
import { confirm } from '@/stores/confirmStore'

type SettingsCategory =
  | 'general'
  | 'weekly'
  | 'templates'
  | 'attachments'
  | 'kanban'
  | 'machines'
  | 'tags'

const CATEGORIES: { id: SettingsCategory; label: string; icon: typeof Info }[] = [
  { id: 'general', label: 'General', icon: Info },
  { id: 'weekly', label: 'Weekly notes', icon: Calendar },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'attachments', label: 'Attachments', icon: Image },
  { id: 'kanban', label: 'Kanban board', icon: Kanban },
  { id: 'machines', label: 'Machines', icon: HardDrive },
  { id: 'tags', label: 'Tags', icon: Hash }
]

const VALID_TAG = /^[A-Za-z0-9_][A-Za-z0-9_/-]*$/

export function SettingsModal(): React.JSX.Element | null {
  const open = useSettingsStore((s) => s.settingsOpen)
  const setOpen = useSettingsStore((s) => s.setSettingsOpen)
  const vaultConfig = useSettingsStore((s) => s.vaultConfig)
  const saveVaultConfig = useSettingsStore((s) => s.saveVaultConfig)
  const readableLineLength = useSettingsStore((s) => s.readableLineLength)
  const setReadableLineLength = useSettingsStore((s) => s.setReadableLineLength)
  const [draft, setDraft] = useState<VaultConfig>(vaultConfig)
  const [category, setCategory] = useState<SettingsCategory>('general')
  // Raw, as-typed text for each machine's attributes field. Kept separate from
  // draft.machines[i].attributes (a string[]) so a keystroke never round-trips
  // through split→join — that round-trip would silently eat a trailing space
  // the instant it's typed, before the next word can be entered.
  const [machineAttrText, setMachineAttrText] = useState<string[]>(
    vaultConfig.machines.map((m) => m.attributes.join(' '))
  )
  const [renamingTag, setRenamingTag] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [tagBusy, setTagBusy] = useState(false)
  const [tagError, setTagError] = useState<string | null>(null)

  const notes = useIndexStore((s) => s.notes)
  const tagCountEntries = useMemo(() => [...tagCounts(notes).entries()], [notes])
  const tagCountMap = useMemo(() => new Map(tagCountEntries), [tagCountEntries])
  const deprecatedSet = useMemo(() => new Set(draft.deprecatedTags), [draft.deprecatedTags])
  const activeTagRows = useMemo(
    () =>
      tagCountEntries
        .filter(([tag]) => !deprecatedSet.has(tag))
        .sort((a, b) => a[0].localeCompare(b[0])),
    [tagCountEntries, deprecatedSet]
  )
  const deprecatedTagRows = useMemo(
    () => draft.deprecatedTags.map((tag): [string, number] => [tag, tagCountMap.get(tag) ?? 0]),
    [draft.deprecatedTags, tagCountMap]
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

  const startRename = (tag: string): void => {
    setTagError(null)
    setRenamingTag(tag)
    setRenameValue(tag)
  }

  const commitRename = async (oldTag: string): Promise<void> => {
    const newTag = renameValue.trim().replace(/^#/, '')
    setRenamingTag(null)
    if (!newTag || newTag === oldTag) return
    if (!VALID_TAG.test(newTag)) {
      setTagError(`"${newTag}" isn't a valid tag name`)
      return
    }
    const count = tagCountMap.get(oldTag) ?? 0
    const ok = await confirm(
      `Rename #${oldTag} to #${newTag} across ${count} note${count === 1 ? '' : 's'}?`
    )
    if (!ok) return
    setTagBusy(true)
    setTagError(null)
    try {
      await window.knote.renameTag(oldTag, newTag)
      if (draft.deprecatedTags.includes(oldTag)) {
        setDraft({
          ...draft,
          deprecatedTags: draft.deprecatedTags.map((t) => (t === oldTag ? newTag : t))
        })
      }
    } finally {
      setTagBusy(false)
    }
  }

  const setTagDeprecated = (tag: string, deprecated: boolean): void => {
    setDraft({
      ...draft,
      deprecatedTags: deprecated
        ? [...draft.deprecatedTags, tag]
        : draft.deprecatedTags.filter((t) => t !== tag)
    })
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
    key: keyof Omit<VaultConfig, 'columns' | 'machines' | 'deprecatedTags'>,
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
                    <div className="settings-row-title">Readable line length</div>
                    <div className="settings-row-desc">
                      Cap note width to a readable column instead of filling the pane
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={readableLineLength}
                    onChange={(e) => setReadableLineLength(e.target.checked)}
                  />
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
                <div className="settings-row">
                  <div>
                    <div className="settings-row-title">GitHub Copilot instructions</div>
                    <div className="settings-row-desc">
                      Teach Copilot KNote&apos;s note format — saved to your Knote Resources
                      folder to copy into a vault&apos;s .github/copilot-instructions.md
                    </div>
                  </div>
                  <button
                    className="icon-btn settings-row-btn"
                    onClick={() => {
                      setOpen(false)
                      void openCopilotInstructions()
                    }}
                  >
                    <Bot size={14} /> Open
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
                      <label
                        className="column-require-reason"
                        title="Require a reason + date whenever a task moves into this column"
                      >
                        <input
                          type="checkbox"
                          checked={!!col.requireReason}
                          onChange={(e) => {
                            const columns = [...draft.columns]
                            columns[i] = { ...col, requireReason: e.target.checked }
                            setDraft({ ...draft, columns })
                          }}
                        />
                        Require reason
                      </label>
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

            {category === 'tags' && (
              <>
                <div className="settings-field">
                  <label>
                    <span className="settings-label">Tags</span>
                    <span className="settings-hint">
                      click a tag to rename it across every note — use this to merge case/spelling
                      variants (e.g. #knote and #KNOTE)
                    </span>
                  </label>
                  {tagError && <div className="settings-tag-error">{tagError}</div>}
                  {activeTagRows.length === 0 && (
                    <div className="panel-empty">No tags in this vault</div>
                  )}
                  {activeTagRows.map(([tag, count]) => (
                    <div key={tag} className="settings-tag-row">
                      {renamingTag === tag ? (
                        <input
                          className="panel-input small"
                          autoFocus
                          value={renameValue}
                          disabled={tagBusy}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => void commitRename(tag)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void commitRename(tag)
                            } else if (e.key === 'Escape') {
                              setRenamingTag(null)
                            }
                          }}
                        />
                      ) : (
                        <span
                          className="settings-tag-name"
                          title="Click to rename"
                          onClick={() => startRename(tag)}
                        >
                          #{tag}
                        </span>
                      )}
                      <span className="settings-tag-count">{count}</span>
                      <button
                        className="icon-btn"
                        title="Deprecate (hide from Tag pane and # picker)"
                        disabled={tagBusy}
                        onClick={() => setTagDeprecated(tag, true)}
                      >
                        <Eye size={13} />
                      </button>
                    </div>
                  ))}
                </div>

                {deprecatedTagRows.length > 0 && (
                  <div className="settings-field">
                    <label>
                      <span className="settings-label">Deprecated tags</span>
                      <span className="settings-hint">
                        hidden from quick access, but left untouched in notes
                      </span>
                    </label>
                    {deprecatedTagRows.map(([tag, count]) => (
                      <div key={tag} className="settings-tag-row settings-tag-row-deprecated">
                        <span className="settings-tag-name settings-tag-name-static">#{tag}</span>
                        <span className="settings-tag-count">{count}</span>
                        <button
                          className="icon-btn"
                          title="Restore to quick access"
                          onClick={() => setTagDeprecated(tag, false)}
                        >
                          <EyeOff size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
