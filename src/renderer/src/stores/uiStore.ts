import { create } from 'zustand'
import type { BoardScope } from '@/board/boardSelectors'

export type SidebarTab = 'files' | 'search' | 'tags'

interface UiState {
  sidebarTab: SidebarTab
  searchQuery: string
  quickSwitcherOpen: boolean
  commandPaletteOpen: boolean
  templatePickerOpen: boolean
  rightPanelOpen: boolean
  setSidebarTab: (tab: SidebarTab) => void
  setSearchQuery: (q: string) => void
  /** Jump to the search panel with a prefilled query (e.g. tag click). */
  searchFor: (q: string) => void
  setQuickSwitcherOpen: (open: boolean) => void
  setCommandPaletteOpen: (open: boolean) => void
  setTemplatePickerOpen: (open: boolean) => void
  toggleRightPanel: () => void

  boardOpen: boolean
  boardScope: BoardScope
  setBoardOpen: (open: boolean) => void
  openBoard: (scope: BoardScope) => void

  toast: string | null
  showToast: (message: string) => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarTab: 'files',
  searchQuery: '',
  quickSwitcherOpen: false,
  commandPaletteOpen: false,
  templatePickerOpen: false,
  rightPanelOpen: true,

  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  searchFor: (q) => set({ sidebarTab: 'search', searchQuery: q }),
  setQuickSwitcherOpen: (quickSwitcherOpen) => set({ quickSwitcherOpen }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setTemplatePickerOpen: (templatePickerOpen) => set({ templatePickerOpen }),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),

  boardOpen: false,
  boardScope: { kind: 'global' },
  setBoardOpen: (boardOpen) => set({ boardOpen }),
  openBoard: (boardScope) => set({ boardScope, boardOpen: true }),

  toast: null,
  showToast: (message) => {
    set({ toast: message })
    setTimeout(() => {
      if (useUiStore.getState().toast === message) set({ toast: null })
    }, 3500)
  }
}))
