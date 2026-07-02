import { useEffect, useMemo, useRef, useState } from 'react'
import fuzzysort from 'fuzzysort'
import { allCommands, type Command } from '@/commands/registry'
import { useUiStore } from '@/stores/uiStore'

export function CommandPalette(): React.JSX.Element | null {
  const open = useUiStore((s) => s.commandPaletteOpen)
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen)
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

  const rows = useMemo<Command[]>(() => {
    const commands = allCommands()
    if (query.trim() === '') return commands
    return fuzzysort.go(query, commands, { key: 'name', limit: 30 }).map((r) => r.obj)
  }, [query, open])

  if (!open) return null

  const pick = (cmd: Command): void => {
    setOpen(false)
    void cmd.run()
  }

  return (
    <div className="modal-overlay" onMouseDown={() => setOpen(false)}>
      <div className="modal-panel" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="modal-input"
          placeholder="Run a command…"
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
              pick(rows[selected])
            }
          }}
        />
        <div className="modal-results">
          {rows.map((cmd, i) => (
            <div
              key={cmd.id}
              className={`modal-result${i === selected ? ' selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => pick(cmd)}
            >
              <span className="modal-result-label">{cmd.name}</span>
              {cmd.hotkey && <span className="modal-result-detail">{cmd.hotkey}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
