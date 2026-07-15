// Form-style frontmatter editing for the note in the active editor. All
// writes go through the host's setFrontmatter (live buffer when the note is
// open, verified disk write otherwise).

import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { isMarkdown, samePath } from '@shared/pathUtils'
import type { NoteMeta } from '@shared/types'
import { host, on } from '../shared/rpc'
import { useIndexStore } from '../shared/stores'

function parseValue(raw: string): unknown {
  const v = raw.trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (v !== '' && !isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if (v.includes(','))
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  return v
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ')
  if (value === null || value === undefined) return ''
  return String(value)
}

function metaFor(notePath: string | null, notes: Map<string, NoteMeta>): NoteMeta | null {
  if (!notePath) return null
  for (const [p, meta] of notes) {
    if (samePath(p, notePath)) return meta
  }
  return null
}

export function PropertiesApp({ initialNote }: { initialNote: string | null }): React.JSX.Element {
  const [notePath, setNotePath] = useState<string | null>(
    initialNote && isMarkdown(initialNote) ? initialNote : null
  )
  const notes = useIndexStore((s) => s.notes)
  const [newKey, setNewKey] = useState('')

  useEffect(
    () =>
      on('activeNoteChanged', (path) => {
        if (path !== null && isMarkdown(path)) setNotePath(path)
      }),
    []
  )

  const meta = metaFor(notePath, notes)
  if (!notePath || !meta) {
    return <div className="panel-empty">Open a note to edit its properties</div>
  }

  const entries = Object.entries(meta.frontmatter)

  const apply = (frontmatter: Record<string, unknown>): void => {
    void host.setFrontmatter(notePath, frontmatter)
  }

  const update = (key: string, rawValue: string): void => {
    apply({ ...meta.frontmatter, [key]: parseValue(rawValue) })
  }

  const remove = (key: string): void => {
    const fm = { ...meta.frontmatter }
    delete fm[key]
    apply(fm)
  }

  const addKey = (): void => {
    const key = newKey.trim()
    if (!key || key in meta.frontmatter) return
    setNewKey('')
    apply({ ...meta.frontmatter, [key]: '' })
  }

  return (
    <div className="side-panel">
      <div className="side-panel-body">
        <div className="properties-note-title" title={notePath}>
          {meta.title}
        </div>
        {meta.frontmatterError && (
          <div className="panel-warning">Frontmatter YAML could not be parsed</div>
        )}
        {entries.map(([key, value]) => (
          <PropertyRow
            key={key}
            name={key}
            value={displayValue(value)}
            onCommit={update}
            onRemove={remove}
          />
        ))}
        <div className="property-row add-row">
          <input
            className="panel-input small"
            placeholder="Add property…"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addKey()
            }}
          />
          <button className="icon-btn" title="Add property" onClick={addKey}>
            <Plus size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

function PropertyRow({
  name,
  value,
  onCommit,
  onRemove
}: {
  name: string
  value: string
  onCommit: (key: string, raw: string) => void
  onRemove: (key: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <div className="property-row">
      <span className="property-key" title={name}>
        {name}
      </span>
      <input
        className="panel-input small"
        value={draft ?? value}
        onFocus={() => setDraft(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== value) onCommit(name, draft)
          setDraft(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setDraft(null)
        }}
      />
      <button className="icon-btn" title="Remove property" onClick={() => onRemove(name)}>
        <X size={13} />
      </button>
    </div>
  )
}
