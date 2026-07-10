import { create } from 'zustand'

// Open/closed state for the read-only bundled-doc dialogs (rendered by
// components/DocDialogs.tsx), opened from Settings → General.

interface DocDialogState {
  open: boolean
  setOpen: (open: boolean) => void
}

const createDocDialogStore = () =>
  create<DocDialogState>((set) => ({
    open: false,
    setOpen: (open) => set({ open })
  }))

/** Settings → Welcome & feature guide (bundled resources/welcome.md). */
export const useWelcomeStore = createDocDialogStore()

/** Settings → Release notes (bundled resources/releaseNotes.md). */
export const useReleaseNotesStore = createDocDialogStore()
