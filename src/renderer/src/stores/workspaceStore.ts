import { create } from 'zustand'
import type { HeadingRef, VaultPath } from '@shared/types'
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
  /** Whether the cursor currently sits on a `- [ ]` task line (for toolbar gating). */
  activeLineIsTask: boolean
  /**
   * Headings of the live editor buffer, recomputed on every doc change (see
   * cmSetup.ts). Like activeLineIsTask, this is derived from the live
   * CodeMirror buffer, not the disk-snapshot `note` — and likewise isn't
   * reset on closeFile(); the Outline panel guards on `note` being present.
   */
  outlineHeadings: HeadingRef[]

  openFile: (path: VaultPath, scrollToLine?: number) => Promise<void>
  /** Clear a pending scroll target once the editor has applied it. */
  clearScrollRequest: () => void
  closeFile: () => void
  setMode: (mode: EditorMode) => void
  setActiveLineIsTask: (isTask: boolean) => void
  setOutlineHeadings: (headings: HeadingRef[]) => void
  markDirty: () => void
  setConflict: (conflict: 'modified' | 'deleted' | null) => void
  markSaved: (content: string, mtimeMs: number) => void
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
  activeLineIsTask: false,
  outlineHeadings: [],

  openFile: async (path, scrollToLine) => {
    const result = await window.knote.readFile(path)
    // Opening a note always returns to the editor view
    const { useUiStore } = await import('./uiStore')
    useUiStore.getState().setBoardOpen(false)
    useUiStore.getState().setTimelineOpen(false)
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

  clearScrollRequest: () => {
    if (get().scrollRequest !== null) set({ scrollRequest: null })
  },

  closeFile: () => set({ note: null, dirty: false, conflict: null }),

  setMode: (mode) => set({ mode }),

  setActiveLineIsTask: (isTask) => {
    if (get().activeLineIsTask !== isTask) set({ activeLineIsTask: isTask })
  },

  setOutlineHeadings: (outlineHeadings) => set({ outlineHeadings }),

  markDirty: () => {
    if (!get().dirty) set({ dirty: true })
  },

  setConflict: (conflict) => set({ conflict }),

  markSaved: (content, mtimeMs) => {
    const note = get().note
    // Keep the disk-snapshot content in sync with what was just written so a
    // later remount (e.g. leaving and returning to the editor) re-seeds the
    // buffer from the saved text, not the stale content from when the note
    // was first opened. Deliberately doesn't bump `version` — that would
    // force-recreate the live CodeMirror instance (losing cursor/undo/focus)
    // on every autosave.
    if (note) set({ dirty: false, note: { ...note, content, mtimeMs } })
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
        // Clean buffer: reconcile with disk. This watcher event is often
        // just an echo of our own autosave (e.g. triggered by an
        // autosave-on-navigate write when leaving the editor for the
        // board), arriving ~200ms late because of the watcher's write-
        // stability delay. If the content already matches what's loaded,
        // just refresh mtimeMs — deliberately not calling openFile()/
        // bumping version, since that would force-recreate the live
        // CodeMirror instance (destroying cursor/scroll/undo) for no
        // reason, and could stomp a scroll-to-line request from an
        // explicit navigation (e.g. a board-card jump) that raced with
        // this same self-echoed event.
        const result = await window.knote.readFile(path)
        const current = get().note
        if (!current || !samePath(current.path, path)) return
        if (result.content === current.content) {
          set({ note: { ...current, mtimeMs: result.mtimeMs } })
        } else {
          await get().openFile(note.path, get().scrollRequest ?? undefined)
        }
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
