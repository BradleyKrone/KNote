// Settings → Hotkeys: rebind any palette command. Click "Record", press the
// new combo (must include Ctrl/Alt, or be an F-key), Escape cancels.
// Editor-internal shortcuts (bold/italic/… inside the note text) are
// CodeMirror keymaps and stay fixed; they're shown here read-only.

import { useEffect, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { allCommands } from '@/commands/registry'
import {
  comboFromEvent,
  commandForCombo,
  DEFAULT_HOTKEYS,
  effectiveHotkey,
  useHotkeyStore
} from '@/commands/hotkeys'

export function HotkeysSection(): React.JSX.Element {
  // Subscribed so rows re-render as bindings change
  useHotkeyStore((s) => s.overrides)
  const setBinding = useHotkeyStore((s) => s.setBinding)
  const resetBinding = useHotkeyStore((s) => s.resetBinding)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!recordingId) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecordingId(null)
        setError(null)
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return // bare key or lone modifier: keep listening
      const taken = commandForCombo(combo)
      if (taken && taken !== recordingId) {
        const takenName = allCommands().find((c) => c.id === taken)?.name ?? taken
        setError(`"${combo}" is already used by "${takenName}"`)
        return
      }
      setBinding(recordingId, combo)
      setRecordingId(null)
      setError(null)
    }
    // Capture phase so the app's global hotkey handler never sees this press
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recordingId, setBinding])

  const commands = allCommands()

  return (
    <>
      <div className="settings-row">
        <div>
          <div className="settings-row-title">Keyboard shortcuts</div>
          <div className="settings-row-desc">
            Click Record, then press the new combination (Ctrl/Alt combos or F-keys). Text-editing
            shortcuts inside a note (bold, italic…) are fixed.
          </div>
        </div>
      </div>
      {error && <div className="settings-hint hotkey-error">{error}</div>}
      {commands.map((cmd) => {
        const fixed = cmd.hotkey !== undefined // editor-level, not rebindable
        const current = fixed ? cmd.hotkey : effectiveHotkey(cmd.id)
        const recording = recordingId === cmd.id
        const overridden = !fixed && cmd.id in useHotkeyStore.getState().overrides
        return (
          <div className="settings-row hotkey-row" key={cmd.id}>
            <div className="settings-row-title">{cmd.name}</div>
            <div className="hotkey-controls">
              <span className={`hotkey-chip${recording ? ' recording' : ''}`}>
                {recording ? 'Press keys…' : (current ?? '—')}
                {fixed && <span className="hotkey-fixed"> · fixed</span>}
              </span>
              {!fixed && (
                <>
                  <button
                    className="icon-btn settings-row-btn"
                    onClick={() => {
                      setError(null)
                      setRecordingId(recording ? null : cmd.id)
                    }}
                  >
                    {recording ? 'Cancel' : 'Record'}
                  </button>
                  {current !== null && !recording && (
                    <button
                      className="icon-btn"
                      title="Remove binding"
                      onClick={() => setBinding(cmd.id, null)}
                    >
                      <X size={13} />
                    </button>
                  )}
                  {overridden && (
                    <button
                      className="icon-btn"
                      title={`Reset to default${DEFAULT_HOTKEYS[cmd.id] ? ` (${DEFAULT_HOTKEYS[cmd.id]})` : ''}`}
                      onClick={() => resetBinding(cmd.id)}
                    >
                      <RotateCcw size={13} />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
