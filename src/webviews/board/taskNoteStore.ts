import { create } from 'zustand'
import type { BoardColumn } from '@shared/types'
import type { BoardCard, BoardScope } from './boardSelectors'

export type TaskNoteTarget =
  | {
      kind: 'edit'
      /**
       * The card as it was when the pencil was clicked. Deliberately a
       * snapshot rather than a live lookup into the index store:
       * `card.rawLine` is the expected text the verified edit checks
       * against, so it has to be what the user was actually looking at —
       * that's what lets a note that moved underneath be refused instead of
       * clobbered.
       */
      card: BoardCard
    }
  | {
      kind: 'create'
      /** Where "Add card" was clicked — which note (or the weekly note) and which column the new task lands in. */
      scope: BoardScope
      column: BoardColumn
    }

interface TaskNoteEditState {
  /** The card being edited, or the column a new one is being composed for — null when the dialog is closed. */
  target: TaskNoteTarget | null
  close: () => void
}

export const useTaskNoteStore = create<TaskNoteEditState>((set) => ({
  target: null,
  close: () => set({ target: null })
}))

/** Open the task editor on this card. */
export function editTaskNote(card: BoardCard): void {
  useTaskNoteStore.setState({ target: { kind: 'edit', card } })
}

/** Open the task editor to compose a brand-new card for this column; saving creates it. */
export function addTaskNote(scope: BoardScope, column: BoardColumn): void {
  useTaskNoteStore.setState({ target: { kind: 'create', scope, column } })
}
