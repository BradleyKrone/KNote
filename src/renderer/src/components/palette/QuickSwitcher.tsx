import { useEffect, useMemo, useState } from 'react'
import fuzzysort from 'fuzzysort'
import { noteCandidates, useIndexStore, type NoteCandidate } from '@/stores/indexStore'
import { useUiStore } from '@/stores/uiStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useVaultStore } from '@/stores/vaultStore'
import { ListModal } from './ListModal'

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

  useEffect(() => {
    if (open) setQuery('')
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
    <ListModal
      rows={rows.map((row, i) => ({ key: `${row.label}-${i}`, label: row.label, detail: row.detail }))}
      onClose={() => setOpen(false)}
      onPick={(i) => void pick(rows[i])}
      input={{ placeholder: 'Jump to a note…', value: query, onChange: setQuery }}
    />
  )
}
