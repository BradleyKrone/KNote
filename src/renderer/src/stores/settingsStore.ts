import { create } from 'zustand'
import {
  DEFAULT_VAULT_CONFIG,
  type DashboardLink,
  type ThemeName,
  type VaultConfig,
  type VaultPath
} from '@shared/types'
import { samePath } from '@shared/pathUtils'

interface SettingsState {
  theme: ThemeName
  readableLineLength: boolean
  vaultConfig: VaultConfig
  settingsOpen: boolean
  setTheme: (theme: ThemeName) => void
  toggleTheme: () => void
  setReadableLineLength: (enabled: boolean) => void
  loadVaultConfig: () => Promise<void>
  saveVaultConfig: (config: VaultConfig) => Promise<void>
  setSettingsOpen: (open: boolean) => void
  /** Pin a note to the Dashboard (no-op if already pinned). */
  pinNote: (path: VaultPath) => Promise<void>
  /** Unpin a note from the Dashboard (no-op if not pinned). */
  unpinNote: (path: VaultPath) => Promise<void>
  /** Add a freeform link (URL or note reference) to the Dashboard. */
  addLink: (label: string, target: string) => Promise<void>
  /** Remove a link from the Dashboard by id. */
  removeLink: (id: string) => Promise<void>
}

function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
}

function applyReadableLineLength(enabled: boolean): void {
  document.documentElement.dataset.readableLineLength = String(enabled)
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: 'dark',
  readableLineLength: true,
  vaultConfig: { ...DEFAULT_VAULT_CONFIG },
  settingsOpen: false,

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
    void window.knote.setTheme(theme)
  },

  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),

  setReadableLineLength: (enabled) => {
    applyReadableLineLength(enabled)
    set({ readableLineLength: enabled })
    void window.knote.setReadableLineLength(enabled)
  },

  loadVaultConfig: async () => {
    set({ vaultConfig: await window.knote.getVaultConfig() })
  },

  saveVaultConfig: async (config) => {
    set({ vaultConfig: config })
    await window.knote.setVaultConfig(config)
  },

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  pinNote: async (path) => {
    const config = get().vaultConfig
    if (config.pinnedNotes.some((p) => samePath(p, path))) return
    await get().saveVaultConfig({ ...config, pinnedNotes: [...config.pinnedNotes, path] })
  },

  unpinNote: async (path) => {
    const config = get().vaultConfig
    await get().saveVaultConfig({
      ...config,
      pinnedNotes: config.pinnedNotes.filter((p) => !samePath(p, path))
    })
  },

  addLink: async (label, target) => {
    const config = get().vaultConfig
    const link: DashboardLink = { id: crypto.randomUUID(), label, target }
    await get().saveVaultConfig({ ...config, links: [...config.links, link] })
  },

  removeLink: async (id) => {
    const config = get().vaultConfig
    await get().saveVaultConfig({ ...config, links: config.links.filter((l) => l.id !== id) })
  }
}))

export async function initSettings(): Promise<void> {
  const settings = await window.knote.getSettings()
  applyTheme(settings.theme)
  applyReadableLineLength(settings.readableLineLength)
  useSettingsStore.setState({
    theme: settings.theme,
    readableLineLength: settings.readableLineLength
  })
  const { useHotkeyStore } = await import('@/commands/hotkeys')
  useHotkeyStore.setState({ overrides: settings.hotkeyOverrides ?? {} })
}
