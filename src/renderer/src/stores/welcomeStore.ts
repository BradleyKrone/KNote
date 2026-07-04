import { create } from 'zustand'

interface WelcomeState {
  open: boolean
  setOpen: (open: boolean) => void
}

export const useWelcomeStore = create<WelcomeState>((set) => ({
  open: false,
  setOpen: (open) => set({ open })
}))
