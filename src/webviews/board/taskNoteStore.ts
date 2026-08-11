import { create } from 'zustand'
import type { BoardCard } from './boardSelectors'

interface TaskNoteEditState {
  /**
   * The card as it was when the pencil was clicked, or null when the dialog is
   * closed. Deliberately a snapshot rather than a live lookup into the index
   * store: `card.rawLine` is the expected text the verified edit checks
   * against, so it has to be what the user was actually looking at — that's
   * what lets a note that moved underneath be refused instead of clobbered.
   */
  card: BoardCard | null
  close: () => void
}

export const useTaskNoteStore = create<TaskNoteEditState>((set) => ({
  card: null,
  close: () => set({ card: null })
}))

/** Open the task editor on this card. */
export function editTaskNote(card: BoardCard): void {
  useTaskNoteStore.setState({ card })
}
