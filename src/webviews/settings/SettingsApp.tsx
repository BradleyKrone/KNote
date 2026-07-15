// KNote vault settings: category sidebar + content pane editing the
// per-vault config (.knote/config.json). App-level settings (theme,
// hotkeys, word wrap) are native VS Code concerns and live in its own
// Settings/Keyboard Shortcuts UIs.

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  Eye,
  EyeOff,
  FileText,
  HardDrive,
  Hash,
  Image,
  Kanban,
  Plus,
  X
} from 'lucide-react'
import type { VaultConfig } from '@shared/types'
import { tagCounts } from '@shared/wikiResolve'
import { host } from '../shared/rpc'
import { confirm, showToast, useConfigStore, useIndexStore } from '../shared/stores'

type SettingsCategory = 'weekly' | 'templates' | 'attachments' | 'kanban' | 'machines' | 'tags'

const CATEGORIES: { id: SettingsCategory; label: string; icon: typeof Calendar }[] = [
  { id: 'weekly', label: 'Weekly notes', icon: Calendar },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'attachments', label: 'Attachments', icon: Image },
  { id: 'kanban', label: 'Kanban board', icon: Kanban },
  { id: 'machines', label: 'Machines', icon: HardDrive },
  { id: 'tags', label: 'Tags', icon: Hash }
]

const VALID_TAG = /^[A-Za-z0-9_][A-Za-z0-9_/-]*$/

export function SettingsApp(): React.JSX.Element {
  const vaultConfig = useConfigStore((s) => s.vaultConfig)
  const [draft, setDraft] = useState<VaultConfig>(vaultConfig)
  const [dirty, setDirty] = useState(false)
  const [category, setCategory] = useState<SettingsCategory>('weekly')
  // Raw, as-typed text for each machine's attributes field. Kept separate from
  // draft.machines[i].attributes (a string[]) so a keystroke never round-trips
  // through split→join — that round-trip would silently eat a trailing space.
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

  // Adopt the loaded config once (the store starts on defaults until the
  // initial getVaultConfig round trip lands) — but never clobber user edits.
  useEffect(() => {
    if (dirty) return
    setDraft(vaultConfig)
    setMachineAttrText(vaultConfig.machines.map((m) => m.attributes.join(' ')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultConfig])

  const edit = (next: VaultConfig): void => {
    setDraft(next)
    setDirty(true)
  }

  const save = async (): Promise<void> => {
    const cleaned: VaultConfig = {
      ...draft,
      columns: draft.columns.filter((c) => c.name.trim() !== '' && c.char.length === 1),
      machines: draft.machines
        .map((m, i) => ({
          ...m,
          serial: m.serial.trim(),
          attributes: (machineAttrText[i] ?? '').trim().split(/\s+/).filter(Boolean)
        }))
        .filter((m) => m.serial !== '')
    }
    await host.setVaultConfig(cleaned)
    setDirty(false)
    showToast('KNote settings saved')
  }

  const moveColumn = (i: number, dir: -1 | 1): void => {
    const j = i + dir
    if (j < 0 || j >= draft.columns.length) return
    const columns = [...draft.columns]
    ;[columns[i], columns[j]] = [columns[j], columns[i]]
    edit({ ...draft, columns })
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
      await host.renameTag(oldTag, newTag)
      if (draft.deprecatedTags.includes(oldTag)) {
        edit({
          ...draft,
          deprecatedTags: draft.deprecatedTags.map((t) => (t === oldTag ? newTag : t))
        })
      }
    } finally {
      setTagBusy(false)
    }
  }

  const setTagDeprecated = (tag: string, deprecated: boolean): void => {
    edit({
      ...draft,
      deprecatedTags: deprecated
        ? [...draft.deprecatedTags, tag]
        : draft.deprecatedTags.filter((t) => t !== tag)
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
        onChange={(e) => edit({ ...draft, [key]: e.target.value })}
      />
    </div>
  )

  return (
    <div className="settings-view">
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
          <div className="settings-sidebar-spacer" />
          <button className="btn-primary settings-save" disabled={!dirty} onClick={() => void save()}>
            {dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>

        <div className="settings-content">
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

          {category === 'templates' &&
            field(
              'Templates folder',
              'templatesFolder',
              'can be a nested path, e.g. "Knote Resources/Templates"'
            )}

          {category === 'attachments' &&
            field(
              'Attachments folder',
              'attachmentsFolder',
              'where pasted images are saved; can be a nested path'
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
                        edit({ ...draft, columns })
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
                        edit({ ...draft, columns })
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
                          edit({ ...draft, columns })
                        }}
                      />
                      Require reason
                    </label>
                    <button
                      className="icon-btn"
                      title="Remove column"
                      onClick={() =>
                        edit({ ...draft, columns: draft.columns.filter((_, j) => j !== i) })
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
                    edit({ ...draft, columns: [...draft.columns, { name: '', char: '?' }] })
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
                      edit({ ...draft, machines })
                    }}
                  />
                  <input
                    className="panel-input small"
                    value={m.model}
                    placeholder="Model (e.g. D6)"
                    onChange={(e) => {
                      const machines = [...draft.machines]
                      machines[i] = { ...m, model: e.target.value }
                      edit({ ...draft, machines })
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
                      setDirty(true)
                    }}
                  />
                  <button
                    className="icon-btn"
                    title="Remove machine"
                    onClick={() => {
                      edit({ ...draft, machines: draft.machines.filter((_, j) => j !== i) })
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
                  edit({
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
                {activeTagRows.length === 0 && <div className="panel-empty">No tags in this vault</div>}
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
  )
}
