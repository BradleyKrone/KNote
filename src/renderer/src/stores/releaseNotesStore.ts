import { create } from 'zustand'

interface ReleaseNotesState {
  open: boolean
  setOpen: (open: boolean) => void
}

export const useReleaseNotesStore = create<ReleaseNotesState>((set) => ({
  open: false,
  setOpen: (open) => set({ open })
}))
