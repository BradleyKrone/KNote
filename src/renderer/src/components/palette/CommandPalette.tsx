import { useEffect, useMemo, useState } from 'react'
import fuzzysort from 'fuzzysort'
import { allCommands, type Command } from '@/commands/registry'
import { useUiStore } from '@/stores/uiStore'
import { ListModal } from './ListModal'

export function CommandPalette(): React.JSX.Element | null {
  const open = useUiStore((s) => s.commandPaletteOpen)
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const rows = useMemo<Command[]>(() => {
    const commands = allCommands()
    if (query.trim() === '') return commands
    return fuzzysort.go(query, commands, { key: 'name', limit: 30 }).map((r) => r.obj)
  }, [query, open])

  if (!open) return null

  return (
    <ListModal
      rows={rows.map((cmd) => ({ key: cmd.id, label: cmd.name, detail: cmd.hotkey }))}
      onClose={() => setOpen(false)}
      onPick={(i) => {
        setOpen(false)
        void rows[i].run()
      }}
      input={{ placeholder: 'Run a command…', value: query, onChange: setQuery }}
    />
  )
}
