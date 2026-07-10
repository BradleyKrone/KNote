import { beforeEach, describe, expect, it, vi } from 'vitest'

// hotkeys.ts persists via window.knote; stub it before import
const setHotkeyOverrides = vi.fn()
;(globalThis as Record<string, unknown>).window = Object.assign(globalThis.window ?? {}, {
  knote: { setHotkeyOverrides }
})

const { comboFromEvent, commandForCombo, effectiveHotkey, useHotkeyStore, DEFAULT_HOTKEYS } =
  await import('../src/renderer/src/commands/hotkeys')

const key = (init: Partial<KeyboardEvent>): KeyboardEvent => init as KeyboardEvent

beforeEach(() => {
  useHotkeyStore.setState({ overrides: {} })
  setHotkeyOverrides.mockClear()
})

describe('comboFromEvent', () => {
  it('builds canonical Ctrl combos with uppercase single keys', () => {
    expect(comboFromEvent(key({ key: 'p', ctrlKey: true }))).toBe('Ctrl+P')
    expect(comboFromEvent(key({ key: 'x', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+X')
    expect(comboFromEvent(key({ key: 'Tab', ctrlKey: true }))).toBe('Ctrl+Tab')
  })

  it('treats Meta as Ctrl', () => {
    expect(comboFromEvent(key({ key: 'o', metaKey: true }))).toBe('Ctrl+O')
  })

  it('rejects bare keys and lone modifiers', () => {
    expect(comboFromEvent(key({ key: 'a' }))).toBeNull()
    expect(comboFromEvent(key({ key: 'a', shiftKey: true }))).toBeNull()
    expect(comboFromEvent(key({ key: 'Control', ctrlKey: true }))).toBeNull()
  })

  it('allows unmodified F-keys', () => {
    expect(comboFromEvent(key({ key: 'F5' }))).toBe('F5')
  })
})

describe('binding resolution', () => {
  it('defaults are live until overridden', () => {
    expect(commandForCombo('Ctrl+P')).toBe('command-palette')
    expect(effectiveHotkey('quick-switcher')).toBe('Ctrl+O')
  })

  it('an override wins and frees the default combo', () => {
    useHotkeyStore.setState({ overrides: { 'command-palette': 'Ctrl+Shift+P' } })
    expect(commandForCombo('Ctrl+Shift+P')).toBe('command-palette')
    expect(commandForCombo('Ctrl+P')).toBeNull()
    expect(effectiveHotkey('command-palette')).toBe('Ctrl+Shift+P')
  })

  it('a null override unbinds the default', () => {
    useHotkeyStore.setState({ overrides: { 'quick-capture': null } })
    expect(effectiveHotkey('quick-capture')).toBeNull()
    expect(commandForCombo('Ctrl+J')).toBeNull()
  })

  it('setBinding back to the default removes the override entry', () => {
    const s = useHotkeyStore.getState()
    s.setBinding('command-palette', 'Ctrl+Shift+P')
    expect(useHotkeyStore.getState().overrides['command-palette']).toBe('Ctrl+Shift+P')
    s.setBinding('command-palette', DEFAULT_HOTKEYS['command-palette'])
    expect('command-palette' in useHotkeyStore.getState().overrides).toBe(false)
    expect(setHotkeyOverrides).toHaveBeenCalled()
  })

  it('binding a command with no default to null leaves no override entry', () => {
    useHotkeyStore.getState().setBinding('open-graph', null)
    expect('open-graph' in useHotkeyStore.getState().overrides).toBe(false)
  })
})
