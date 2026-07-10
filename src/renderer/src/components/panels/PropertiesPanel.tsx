import { useState } from 'react'
import { stringify as yamlStringify } from 'yaml'
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useUiStore } from '@/stores/uiStore'
import { getActiveEditorView } from '@/editor/activeView'
import { useOpenNoteMeta } from './BacklinksPanel'

/**
 * Form-style frontmatter editing. All writes go through the live editor
 * buffer (a CM transaction replacing the YAML block) so auto-save and the
 * index pick them up like any other edit.
 */

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

function applyFrontmatter(frontmatter: Record<string, unknown>): void {
  const view = getActiveEditorView()
  if (!view) return
  const doc = view.state.doc
  const hasAny = Object.keys(frontmatter).length > 0
  const block = hasAny ? `---\n${yamlStringify(frontmatter).trimEnd()}\n---` : ''

  // Locate an existing frontmatter block at the top of the doc
  let replaceTo = 0
  if (doc.lines > 1 && doc.line(1).text === '---') {
    for (let ln = 2; ln <= Math.min(doc.lines, 200); ln++) {
      if (doc.line(ln).text === '---') {
        const end = doc.line(ln).to
        replaceTo = end < doc.length ? end + 1 : end
        break
      }
    }
  }
  const insert = block === '' ? '' : replaceTo === 0 ? block + '\n' : block + '\n'
  view.dispatch({
    changes: { from: 0, to: replaceTo, insert },
    userEvent: 'input.knote.frontmatter'
  })
}

export function PropertiesPanel(): React.JSX.Element {
  const note = useWorkspaceStore((s) => s.note)
  const meta = useOpenNoteMeta()
  const [newKey, setNewKey] = useState('')
  const collapsed = useUiStore((s) => s.propertiesCollapsed)
  const toggleProperties = useUiStore((s) => s.toggleProperties)

  if (!note || !meta) return <></>

  const entries = Object.entries(meta.frontmatter)

  const update = (key: string, rawValue: string): void => {
    applyFrontmatter({ ...meta.frontmatter, [key]: parseValue(rawValue) })
  }

  const remove = (key: string): void => {
    const fm = { ...meta.frontmatter }
    delete fm[key]
    applyFrontmatter(fm)
  }

  const addKey = (): void => {
    const key = newKey.trim()
    if (!key || key in meta.frontmatter) return
    setNewKey('')
    applyFrontmatter({ ...meta.frontmatter, [key]: '' })
  }

  return (
    <div className="right-section">
      <div className="right-section-title section-header" onClick={toggleProperties}>
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <span>Properties</span>
      </div>
      {!collapsed && (
        <>
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
        </>
      )}
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
