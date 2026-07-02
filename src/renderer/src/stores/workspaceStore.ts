import { create } from 'zustand'
import type { VaultPath } from '@shared/types'
import { isInside, normalizeRel, samePath } from '@shared/pathUtils'

export type EditorMode = 'live' | 'source' | 'reading'

export interface OpenNote {
  path: VaultPath
  /** Content as loaded from disk (the editor owns the live buffer). */
  content: string
  mtimeMs: number
  /** Original line-ending style, preserved on save. */
  eol: '\n' | '\r\n'
  /**
   * Bumped every time content is replaced from disk; the editor component
   * uses it to know it must reset its buffer.
   */
  version: number
}

interface WorkspaceState {
  note: OpenNote | null
  dirty: boolean
  /** External change arrived while the buffer was dirty. */
  conflict: 'modified' | 'deleted' | null
  mode: EditorMode
  /** 0-based line to scroll to once the editor (re)mounts (heading links). */
  scrollRequest: number | null

  openFile: (path: VaultPath, scrollToLine?: number) => Promise<void>
  consumeScrollRequest: () => number | null
  closeFile: () => void
  setMode: (mode: EditorMode) => void
  markDirty: () => void
  setConflict: (conflict: 'modified' | 'deleted' | null) => void
  markSaved: (mtimeMs: number) => void
  /** A rename/move changed the open file's path. */
  pathChanged: (oldPath: VaultPath, newPath: VaultPath) => void
  /** Watcher reported an external change to some path. */
  handleExternalChange: (path: VaultPath, kind: string) => Promise<void>
  resolveConflict: (choice: 'reload' | 'keep') => Promise<void>
}

function detectEol(content: string): '\n' | '\r\n' {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  note: null,
  dirty: false,
  conflict: null,
  mode: 'live',
  scrollRequest: null,

  openFile: async (path, scrollToLine) => {
    const result = await window.knote.readFile(path)
    // Opening a note always returns to the editor view
    const { useUiStore } = await import('./uiStore')
    useUiStore.getState().setBoardOpen(false)
    const prev = get().note
    set({
      note: {
        path: normalizeRel(path),
        content: result.content,
        mtimeMs: result.mtimeMs,
        eol: detectEol(result.content),
        version: (prev?.version ?? 0) + 1
      },
      dirty: false,
      conflict: null,
      scrollRequest: scrollToLine ?? null
    })
  },

  consumeScrollRequest: () => {
    const line = get().scrollRequest
    if (line !== null) set({ scrollRequest: null })
    return line
  },

  closeFile: () => set({ note: null, dirty: false, conflict: null }),

  setMode: (mode) => set({ mode }),

  markDirty: () => {
    if (!get().dirty) set({ dirty: true })
  },

  setConflict: (conflict) => set({ conflict }),

  markSaved: (mtimeMs) => {
    const note = get().note
    if (note) set({ dirty: false, note: { ...note, mtimeMs } })
  },

  pathChanged: (oldPath, newPath) => {
    const note = get().note
    if (!note) return
    if (samePath(note.path, oldPath)) {
      set({ note: { ...note, path: normalizeRel(newPath) } })
    } else if (isInside(note.path, oldPath)) {
      // A parent folder moved/renamed
      const suffix = note.path.slice(normalizeRel(oldPath).length)
      set({ note: { ...note, path: normalizeRel(newPath) + suffix } })
    }
  },

  handleExternalChange: async (path, kind) => {
    const { note, dirty } = get()
    if (!note || !samePath(note.path, path)) return
    if (kind === 'unlink') {
      if (dirty) set({ conflict: 'deleted' })
      else get().closeFile()
      return
    }
    if (kind === 'change' || kind === 'add') {
      if (dirty) {
        set({ conflict: 'modified' })
      } else {
        // Clean buffer: silently reload from disk
        await get().openFile(note.path)
      }
    }
  },

  resolveConflict: async (choice) => {
    const note = get().note
    if (!note) return
    if (choice === 'reload') {
      await get().openFile(note.path)
    } else {
      // Keep my version: the editor flushes its buffer to disk
      set({ conflict: null })
      keepMineRequested?.()
    }
  }
}))

/**
 * The editor component registers a flush callback here so "Keep my version"
 * can force-save the live buffer (the store never holds the live buffer).
 */
let keepMineRequested: (() => void) | null = null
export function registerKeepMine(cb: (() => void) | null): void {
  keepMineRequested = cb
}
