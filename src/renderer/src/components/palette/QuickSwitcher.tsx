import { useEffect, useMemo, useRef, useState } from 'react'
import fuzzysort from 'fuzzysort'
import { noteCandidates, useIndexStore, type NoteCandidate } from '@/stores/indexStore'
import { useUiStore } from '@/stores/uiStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useVaultStore } from '@/stores/vaultStore'

const LIMIT = 50

interface Row {
  candidate: NoteCandidate | null // null = "create new note"
  label: string
  detail: string
}

export function QuickSwitcher(): React.JSX.Element | null {
  const open = useUiStore((s) => s.quickSwitcherOpen)
  const setOpen = useUiStore((s) => s.setQuickSwitcherOpen)
  const notes = useIndexStore((s) => s.notes)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const rows = useMemo<Row[]>(() => {
    const candidates = noteCandidates(notes)
    let matched: Row[]
    if (query.trim() === '') {
      matched = candidates
        .slice()
        .sort((a, b) => (a.alias ?? a.title).localeCompare(b.alias ?? b.title))
        .slice(0, LIMIT)
        .map((c) => ({
          candidate: c,
          label: c.alias ?? c.title,
          detail: c.alias ? `→ ${c.title}` : c.path
        }))
    } else {
      const results = fuzzysort.go(query, candidates, {
        keys: ['title', 'alias', 'path'],
        limit: LIMIT
      })
      matched = results.map((r) => ({
        candidate: r.obj,
        label: r.obj.alias ?? r.obj.title,
        detail: r.obj.alias ? `→ ${r.obj.title}` : r.obj.path
      }))
    }
    if (query.trim() !== '') {
      matched.push({ candidate: null, label: `Create "${query.trim()}"`, detail: 'new note' })
    }
    return matched
  }, [notes, query])

  if (!open) return null

  const pick = async (row: Row): Promise<void> => {
    setOpen(false)
    if (row.candidate) {
      await useWorkspaceStore.getState().openFile(row.candidate.path)
    } else {
      const created = await window.knote.createFile(query.trim() + '.md', '')
      await useVaultStore.getState().refreshTree()
      await useWorkspaceStore.getState().openFile(created)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={() => setOpen(false)}>
      <div className="modal-panel" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="modal-input"
          placeholder="Jump to a note…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelected((s) => Math.min(s + 1, rows.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((s) => Math.max(s - 1, 0))
            } else if (e.key === 'Enter' && rows[selected]) {
              void pick(rows[selected])
            }
          }}
        />
        <div className="modal-results">
          {rows.map((row, i) => (
            <div
              key={`${row.label}-${i}`}
              className={`modal-result${i === selected ? ' selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => void pick(row)}
            >
              <span className="modal-result-label">{row.label}</span>
              <span className="modal-result-detail">{row.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
