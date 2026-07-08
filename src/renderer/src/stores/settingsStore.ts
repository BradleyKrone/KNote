import { create } from 'zustand'
import { DEFAULT_VAULT_CONFIG, type ThemeName, type VaultConfig } from '@shared/types'

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

  setSettingsOpen: (settingsOpen) => set({ settingsOpen })
}))

export async function initSettings(): Promise<void> {
  const settings = await window.knote.getSettings()
  applyTheme(settings.theme)
  applyReadableLineLength(settings.readableLineLength)
  useSettingsStore.setState({
    theme: settings.theme,
    readableLineLength: settings.readableLineLength
  })
}
