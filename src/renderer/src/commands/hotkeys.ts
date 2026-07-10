// Customizable command hotkeys. Defaults live here; user overrides
// (commandId → combo, or null to unbind) persist in app settings and are
// loaded at startup. App.tsx dispatches window keydowns through
// commandForEvent; the Settings → Hotkeys section edits bindings.
//
// Editor-internal keys (Ctrl+B/I/…, list/task Enter handling, completion
// keys) are CodeMirror keymaps, not commands — they are fixed and not
// listed here.

import { create } from 'zustand'

/** Default bindings for rebindable global commands. */
export const DEFAULT_HOTKEYS: Record<string, string> = {
  'command-palette': 'Ctrl+P',
  'quick-switcher': 'Ctrl+O',
  'quick-capture': 'Ctrl+J',
  'new-note': 'Ctrl+N',
  'mode-reading': 'Ctrl+E',
  'tab-next': 'Ctrl+Tab',
  'tab-prev': 'Ctrl+Shift+Tab'
}

/** Canonical combo string ("Ctrl+Shift+K") for a keyboard event, or null for a bare/modifier key. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const key = e.key
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null
  const isFnKey = /^F\d{1,2}$/.test(key)
  // Without a real modifier, only F-keys are allowed as global hotkeys —
  // anything else would swallow plain typing.
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !isFnKey) return null
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(key.length === 1 ? key.toUpperCase() : key)
  return parts.join('+')
}

interface HotkeyState {
  /** User overrides only; null means "default explicitly unbound". */
  overrides: Record<string, string | null>
  setBinding: (commandId: string, combo: string | null) => void
  resetBinding: (commandId: string) => void
  resetAll: () => void
}

export const useHotkeyStore = create<HotkeyState>((set, get) => ({
  overrides: {},

  setBinding: (commandId, combo) => {
    const overrides = { ...get().overrides }
    if (combo === DEFAULT_HOTKEYS[commandId] || (combo === null && !DEFAULT_HOTKEYS[commandId])) {
      delete overrides[commandId] // back to default
    } else {
      overrides[commandId] = combo
    }
    set({ overrides })
    void window.knote.setHotkeyOverrides(overrides)
  },

  resetBinding: (commandId) => {
    const overrides = { ...get().overrides }
    delete overrides[commandId]
    set({ overrides })
    void window.knote.setHotkeyOverrides(overrides)
  },

  resetAll: () => {
    set({ overrides: {} })
    void window.knote.setHotkeyOverrides({})
  }
}))

/** The effective combo for a command, or null when unbound. */
export function effectiveHotkey(commandId: string): string | null {
  const overrides = useHotkeyStore.getState().overrides
  if (commandId in overrides) return overrides[commandId]
  return DEFAULT_HOTKEYS[commandId] ?? null
}

/** The command a combo currently triggers, or null. */
export function commandForCombo(combo: string): string | null {
  const overrides = useHotkeyStore.getState().overrides
  // Overrides win; a default is live unless overridden away
  for (const [id, c] of Object.entries(overrides)) {
    if (c === combo) return id
  }
  for (const [id, c] of Object.entries(DEFAULT_HOTKEYS)) {
    if (c === combo && !(id in overrides)) return id
  }
  return null
}

/** The command a keydown should run, or null. */
export function commandForEvent(e: KeyboardEvent): string | null {
  const combo = comboFromEvent(e)
  return combo ? commandForCombo(combo) : null
}
