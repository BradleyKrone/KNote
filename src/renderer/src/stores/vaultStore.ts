import { create } from 'zustand'
import type { FileEntry, VaultInfo } from '@shared/types'
import { useIndexStore } from './indexStore'

interface VaultState {
  vault: VaultInfo | null
  tree: FileEntry[]
  loading: boolean
  setVault: (vault: VaultInfo | null) => void
  refreshTree: () => Promise<void>
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null

export const useVaultStore = create<VaultState>((set, get) => ({
  vault: null,
  tree: [],
  loading: true,

  setVault: (vault) => {
    set({ vault })
    if (vault) {
      void get().refreshTree()
      // The main process finishes indexing before vault open resolves
      void useIndexStore.getState().hydrate()
      void import('./settingsStore').then((m) => m.useSettingsStore.getState().loadVaultConfig())
    } else {
      set({ tree: [] })
      useIndexStore.getState().clear()
    }
  },

  refreshTree: async () => {
    const tree = await window.knote.getTree()
    set({ tree })
  }
}))

/** Debounced tree refresh — external file events can arrive in bursts. */
export function scheduleTreeRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void useVaultStore.getState().refreshTree()
  }, 150)
}

/** Try the remembered vault, otherwise leave the picker showing. */
export async function initVault(): Promise<void> {
  const store = useVaultStore.getState()
  try {
    const settings = await window.knote.getSettings()
    if (settings.lastVault) {
      const info = await window.knote.openVaultPath(settings.lastVault)
      store.setVault(info)
    }
  } catch {
    // last vault missing/moved — fall through to the picker
  } finally {
    useVaultStore.setState({ loading: false })
  }
}
