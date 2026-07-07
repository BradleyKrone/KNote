import { create } from 'zustand'
import type { BoardScope } from '@/board/boardSelectors'

export type SidebarTab = 'files' | 'search' | 'tags'

interface UiState {
  sidebarTab: SidebarTab
  searchQuery: string
  quickSwitcherOpen: boolean
  commandPaletteOpen: boolean
  templatePickerOpen: boolean
  quickCaptureOpen: boolean
  rightPanelOpen: boolean
  /** Per-section collapse for the Outline section, independent of rightPanelOpen. */
  outlineCollapsed: boolean
  /** Per-section collapse for the Properties section, independent of rightPanelOpen. */
  propertiesCollapsed: boolean
  /** Per-section collapse for the Backlinks section, independent of rightPanelOpen. */
  backlinksCollapsed: boolean
  /** Per-section collapse for the Unlinked mentions section, independent of rightPanelOpen. */
  unlinkedMentionsCollapsed: boolean
  setSidebarTab: (tab: SidebarTab) => void
  setSearchQuery: (q: string) => void
  /** Jump to the search panel with a prefilled query (e.g. tag click). */
  searchFor: (q: string) => void
  setQuickSwitcherOpen: (open: boolean) => void
  setCommandPaletteOpen: (open: boolean) => void
  setTemplatePickerOpen: (open: boolean) => void
  setQuickCaptureOpen: (open: boolean) => void
  toggleRightPanel: () => void
  toggleOutline: () => void
  toggleProperties: () => void
  toggleBacklinks: () => void
  toggleUnlinkedMentions: () => void

  boardOpen: boolean
  boardScope: BoardScope
  setBoardOpen: (open: boolean) => void
  openBoard: (scope: BoardScope) => void

  timelineOpen: boolean
  setTimelineOpen: (open: boolean) => void

  machineLogOpen: boolean
  setMachineLogOpen: (open: boolean) => void

  graphOpen: boolean
  setGraphOpen: (open: boolean) => void

  toast: string | null
  showToast: (message: string) => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarTab: 'files',
  searchQuery: '',
  quickSwitcherOpen: false,
  commandPaletteOpen: false,
  templatePickerOpen: false,
  quickCaptureOpen: false,
  rightPanelOpen: true,
  outlineCollapsed: false,
  propertiesCollapsed: false,
  backlinksCollapsed: false,
  unlinkedMentionsCollapsed: false,

  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  searchFor: (q) => set({ sidebarTab: 'search', searchQuery: q }),
  setQuickSwitcherOpen: (quickSwitcherOpen) => set({ quickSwitcherOpen }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setTemplatePickerOpen: (templatePickerOpen) => set({ templatePickerOpen }),
  setQuickCaptureOpen: (quickCaptureOpen) => set({ quickCaptureOpen }),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleOutline: () => set((s) => ({ outlineCollapsed: !s.outlineCollapsed })),
  toggleProperties: () => set((s) => ({ propertiesCollapsed: !s.propertiesCollapsed })),
  toggleBacklinks: () => set((s) => ({ backlinksCollapsed: !s.backlinksCollapsed })),
  toggleUnlinkedMentions: () =>
    set((s) => ({ unlinkedMentionsCollapsed: !s.unlinkedMentionsCollapsed })),

  boardOpen: false,
  boardScope: { kind: 'global' },
  setBoardOpen: (boardOpen) => set({ boardOpen }),
  openBoard: (boardScope) =>
    set({
      boardScope,
      boardOpen: true,
      timelineOpen: false,
      machineLogOpen: false,
      graphOpen: false
    }),

  timelineOpen: false,
  setTimelineOpen: (timelineOpen) =>
    set(
      timelineOpen
        ? { timelineOpen, boardOpen: false, machineLogOpen: false, graphOpen: false }
        : { timelineOpen }
    ),

  machineLogOpen: false,
  setMachineLogOpen: (machineLogOpen) =>
    set(
      machineLogOpen
        ? { machineLogOpen, boardOpen: false, timelineOpen: false, graphOpen: false }
        : { machineLogOpen }
    ),

  graphOpen: false,
  setGraphOpen: (graphOpen) =>
    set(
      graphOpen
        ? { graphOpen, boardOpen: false, timelineOpen: false, machineLogOpen: false }
        : { graphOpen }
    ),

  toast: null,
  showToast: (message) => {
    set({ toast: message })
    setTimeout(() => {
      if (useUiStore.getState().toast === message) set({ toast: null })
    }, 3500)
  }
}))
