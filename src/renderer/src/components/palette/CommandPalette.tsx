import { useEffect, useState } from 'react'
import fuzzysort from 'fuzzysort'
import { allCommands, type Command } from '@/commands/registry'
import { effectiveHotkey } from '@/commands/hotkeys'
import { useUiStore } from '@/stores/uiStore'
import { ListModal } from './ListModal'

export function CommandPalette(): React.JSX.Element | null {
  const open = useUiStore((s) => s.commandPaletteOpen)
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  if (!open) return null

  // Cheap enough to compute per render (renders only on open/query changes)
  const rows: Command[] =
    query.trim() === ''
      ? allCommands()
      : fuzzysort.go(query, allCommands(), { key: 'name', limit: 30 }).map((r) => r.obj)

  return (
    <ListModal
      rows={rows.map((cmd) => ({
        key: cmd.id,
        label: cmd.name,
        detail: effectiveHotkey(cmd.id) ?? cmd.hotkey
      }))}
      onClose={() => setOpen(false)}
      onPick={(i) => {
        setOpen(false)
        void rows[i].run()
      }}
      input={{ placeholder: 'Run a command…', value: query, onChange: setQuery }}
    />
  )
}
