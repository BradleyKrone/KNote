// The workspace: which notes are open, in which pane, and the state of each
// pane's active buffer (dirty/conflict/scroll). Supports one pane or a
// two-pane split (vertical/horizontal); each pane has its own tab list and
// its own active note. The legacy top-level fields (note/dirty/conflict/
// scrollRequest) are kept as live mirrors of the ACTIVE pane so the many
// single-note-era consumers (TopBar, panels, board actions, commands) keep
// working unchanged.

import { create } from 'zustand'
import type { HeadingRef, VaultPath } from '@shared/types'
import { isInside, normalizeRel, samePath } from '@shared/pathUtils'

export type EditorMode = 'live' | 'source' | 'reading'
export type SplitDirection = 'vertical' | 'horizontal'

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

export interface PaneState {
  /** Open tab paths, in strip order. The active tab is `note?.path`. */
  tabs: VaultPath[]
  note: OpenNote | null
  dirty: boolean
  /** External change arrived while the buffer was dirty. */
  conflict: 'modified' | 'deleted' | null
  /** 0-based line to scroll to once the editor (re)mounts (heading links). */
  scrollRequest: number | null
}

interface WorkspaceState {
  /** One pane, or two when split. */
  panes: PaneState[]
  activePane: number
  split: SplitDirection | null

  // ---- Mirrors of panes[activePane] (read-only for consumers) ----
  note: OpenNote | null
  dirty: boolean
  conflict: 'modified' | 'deleted' | null
  scrollRequest: number | null

  mode: EditorMode
  /** Whether the cursor currently sits on a `- [ ]` task line (for toolbar gating). */
  activeLineIsTask: boolean
  /**
   * Headings of the focused live editor buffer, recomputed on every doc
   * change (see cmSetup.ts). Derived from the live CodeMirror buffer, not
   * the disk-snapshot `note`; the Outline panel guards on `note`.
   */
  outlineHeadings: HeadingRef[]

  /** Open a note in the active pane (adds a tab if not already open there). */
  openFile: (path: VaultPath, scrollToLine?: number) => Promise<void>
  openFileInPane: (pane: number, path: VaultPath, scrollToLine?: number) => Promise<void>
  /** Close one tab in a pane; activates a neighbor, unsplits an emptied second pane. */
  closeTab: (pane: number, path: VaultPath) => void
  /** Close every tab showing `path` (or inside folder `path`) in every pane. */
  closeTabsForPath: (path: VaultPath) => void
  /** Close everything (e.g. switching vaults). */
  closeAll: () => void
  nextTab: () => Promise<void>
  prevTab: () => Promise<void>
  closeActiveTab: () => void
  setActivePane: (pane: number) => void
  /** Split into two panes (carrying the active tab into the new one), or re-orient an existing split. */
  splitPane: (direction: SplitDirection) => void
  closeSplit: () => void

  setMode: (mode: EditorMode) => void
  setActiveLineIsTask: (isTask: boolean) => void
  setOutlineHeadings: (headings: HeadingRef[]) => void

  // ---- Pane-scoped buffer lifecycle (called by each pane's EditorPane) ----
  clearScrollRequest: (pane: number) => void
  markDirty: (pane: number) => void
  setConflict: (pane: number, conflict: 'modified' | 'deleted' | null) => void
  markSaved: (pane: number, content: string, mtimeMs: number) => void
  resolveConflict: (pane: number, choice: 'reload' | 'keep') => Promise<void>

  /** A rename/move changed an open file's path. */
  pathChanged: (oldPath: VaultPath, newPath: VaultPath) => void
  /** Watcher reported an external change to some path. */
  handleExternalChange: (path: VaultPath, kind: string) => Promise<void>
}

function detectEol(content: string): '\n' | '\r\n' {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

const emptyPane = (): PaneState => ({
  tabs: [],
  note: null,
  dirty: false,
  conflict: null,
  scrollRequest: null
})

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /** Apply a patch to one pane, refreshing the active-pane mirrors. */
  const patchPane = (pane: number, patch: Partial<PaneState>): void => {
    const s = get()
    if (pane < 0 || pane >= s.panes.length) return
    const panes = s.panes.map((p, i) => (i === pane ? { ...p, ...patch } : p))
    set({ panes, ...mirrorsOf(panes, s.activePane) })
  }

  const mirrorsOf = (
    panes: PaneState[],
    activePane: number
  ): Pick<WorkspaceState, 'note' | 'dirty' | 'conflict' | 'scrollRequest'> => {
    const p = panes[activePane] ?? panes[0]
    return {
      note: p?.note ?? null,
      dirty: p?.dirty ?? false,
      conflict: p?.conflict ?? null,
      scrollRequest: p?.scrollRequest ?? null
    }
  }

  return {
    panes: [emptyPane()],
    activePane: 0,
    split: null,

    note: null,
    dirty: false,
    conflict: null,
    scrollRequest: null,

    mode: 'live',
    activeLineIsTask: false,
    outlineHeadings: [],

    openFile: async (path, scrollToLine) => {
      await get().openFileInPane(get().activePane, path, scrollToLine)
    },

    openFileInPane: async (pane, path, scrollToLine) => {
      const result = await window.knote.readFile(path)
      // Opening a note always returns to the editor view
      const { useUiStore } = await import('./uiStore')
      useUiStore.getState().setBoardOpen(false)
      useUiStore.getState().setTimelineOpen(false)
      const s = get()
      if (pane < 0 || pane >= s.panes.length) pane = s.activePane
      const p = s.panes[pane]
      const clean = normalizeRel(path)
      const tabs = p.tabs.some((t) => samePath(t, clean)) ? p.tabs : [...p.tabs, clean]
      const panes = s.panes.map((cur, i) =>
        i === pane
          ? {
              ...cur,
              tabs,
              note: {
                path: clean,
                content: result.content,
                mtimeMs: result.mtimeMs,
                eol: detectEol(result.content),
                version: (cur.note?.version ?? 0) + 1
              },
              dirty: false,
              conflict: null,
              scrollRequest: scrollToLine ?? null
            }
          : cur
      )
      set({ panes, activePane: pane, ...mirrorsOf(panes, pane) })
    },

    closeTab: (pane, path) => {
      const s = get()
      const p = s.panes[pane]
      if (!p) return
      const idx = p.tabs.findIndex((t) => samePath(t, path))
      if (idx === -1) return
      const tabs = p.tabs.filter((_, i) => i !== idx)
      const wasActive = p.note !== null && samePath(p.note.path, path)

      // Second pane emptied → collapse the split
      if (tabs.length === 0 && s.panes.length === 2) {
        const panes = s.panes.filter((_, i) => i !== pane)
        const activePane = 0
        set({ panes, activePane, split: null, ...mirrorsOf(panes, activePane) })
        return
      }

      if (!wasActive) {
        patchPane(pane, { tabs })
        return
      }
      patchPane(pane, { tabs, note: null, dirty: false, conflict: null, scrollRequest: null })
      // Activate the nearest remaining neighbor, if any
      const neighbor = tabs[Math.min(idx, tabs.length - 1)]
      if (neighbor) void get().openFileInPane(pane, neighbor)
    },

    closeTabsForPath: (path) => {
      const s = get()
      const affected = (t: VaultPath): boolean => samePath(t, path) || isInside(t, path)
      // Close per-tab so neighbor-activation and split-collapse logic apply
      for (let pane = s.panes.length - 1; pane >= 0; pane--) {
        for (const tab of [...s.panes[pane].tabs]) {
          if (affected(tab)) get().closeTab(pane, tab)
        }
      }
    },

    closeAll: () => {
      const panes = [emptyPane()]
      set({ panes, activePane: 0, split: null, ...mirrorsOf(panes, 0) })
    },

    nextTab: async () => {
      const s = get()
      const p = s.panes[s.activePane]
      if (!p || p.tabs.length < 2 || !p.note) return
      const idx = p.tabs.findIndex((t) => samePath(t, p.note!.path))
      await get().openFileInPane(s.activePane, p.tabs[(idx + 1) % p.tabs.length])
    },

    prevTab: async () => {
      const s = get()
      const p = s.panes[s.activePane]
      if (!p || p.tabs.length < 2 || !p.note) return
      const idx = p.tabs.findIndex((t) => samePath(t, p.note!.path))
      await get().openFileInPane(s.activePane, p.tabs[(idx - 1 + p.tabs.length) % p.tabs.length])
    },

    closeActiveTab: () => {
      const s = get()
      const p = s.panes[s.activePane]
      if (p?.note) get().closeTab(s.activePane, p.note.path)
    },

    setActivePane: (pane) => {
      const s = get()
      if (pane === s.activePane || pane < 0 || pane >= s.panes.length) return
      set({ activePane: pane, ...mirrorsOf(s.panes, pane) })
    },

    splitPane: (direction) => {
      const s = get()
      if (s.panes.length === 2) {
        set({ split: direction })
        return
      }
      const active = s.panes[s.activePane]
      const second: PaneState = active.note
        ? {
            ...emptyPane(),
            tabs: [active.note.path],
            // Same disk snapshot; the new pane's editor builds its own buffer
            note: { ...active.note, version: 1 }
          }
        : emptyPane()
      const panes = [...s.panes, second]
      set({ panes, split: direction, activePane: 1, ...mirrorsOf(panes, 1) })
    },

    closeSplit: () => {
      const s = get()
      if (s.panes.length < 2) return
      // Keep the first pane; the second pane's editor flushes unsaved edits
      // on unmount (EditorPane teardown), so closing here is safe.
      const panes = [s.panes[0]]
      set({ panes, activePane: 0, split: null, ...mirrorsOf(panes, 0) })
    },

    setMode: (mode) => set({ mode }),

    setActiveLineIsTask: (isTask) => {
      if (get().activeLineIsTask !== isTask) set({ activeLineIsTask: isTask })
    },

    setOutlineHeadings: (outlineHeadings) => set({ outlineHeadings }),

    clearScrollRequest: (pane) => {
      if (get().panes[pane]?.scrollRequest !== null) patchPane(pane, { scrollRequest: null })
    },

    markDirty: (pane) => {
      if (!get().panes[pane]?.dirty) patchPane(pane, { dirty: true })
    },

    setConflict: (pane, conflict) => patchPane(pane, { conflict }),

    markSaved: (pane, content, mtimeMs) => {
      const s = get()
      const p = s.panes[pane]
      if (!p?.note) return
      // Keep the disk-snapshot content in sync with what was just written so a
      // later remount re-seeds the buffer from the saved text. Deliberately
      // doesn't bump `version` — that would force-recreate the live CodeMirror
      // instance (losing cursor/undo/focus) on every autosave.
      const savedPath = p.note.path
      const panes = s.panes.map((cur, i) => {
        if (i === pane) {
          return { ...cur, dirty: false, note: { ...cur.note!, content, mtimeMs } }
        }
        // The same note open (and clean) in the other pane: refresh it from
        // this save so it can't silently go stale — the watcher suppresses
        // our own write's echo, so it would never hear about it otherwise.
        // Bumping version rebuilds that pane's editor (its cursor resets).
        if (cur.note && samePath(cur.note.path, savedPath) && !cur.dirty) {
          return {
            ...cur,
            note: { ...cur.note, content, mtimeMs, version: cur.note.version + 1 }
          }
        }
        return cur
      })
      set({ panes, ...mirrorsOf(panes, s.activePane) })
    },

    resolveConflict: async (pane, choice) => {
      const p = get().panes[pane]
      if (!p?.note) return
      if (choice === 'reload') {
        await get().openFileInPane(pane, p.note.path)
      } else {
        // Keep my version: the pane's editor flushes its buffer to disk
        patchPane(pane, { conflict: null })
        keepMineCallbacks.get(pane)?.()
      }
    },

    pathChanged: (oldPath, newPath) => {
      const s = get()
      const from = normalizeRel(oldPath)
      const to = normalizeRel(newPath)
      const mapPath = (p: VaultPath): VaultPath => {
        if (samePath(p, from)) return to
        if (isInside(p, from)) return to + p.slice(from.length) // parent folder moved
        return p
      }
      const panes = s.panes.map((cur) => ({
        ...cur,
        tabs: cur.tabs.map(mapPath),
        note: cur.note ? { ...cur.note, path: mapPath(cur.note.path) } : null
      }))
      set({ panes, ...mirrorsOf(panes, s.activePane) })
    },

    handleExternalChange: async (path, kind) => {
      for (let pane = 0; pane < get().panes.length; pane++) {
        const p = get().panes[pane]
        if (!p?.note || !samePath(p.note.path, path)) continue
        if (kind === 'unlink') {
          if (p.dirty) patchPane(pane, { conflict: 'deleted' })
          else get().closeTab(pane, p.note.path)
          continue
        }
        if (kind === 'change' || kind === 'add') {
          if (p.dirty) {
            patchPane(pane, { conflict: 'modified' })
          } else {
            // Clean buffer: reconcile with disk. This watcher event is often
            // just an echo of our own autosave, arriving ~200ms late because
            // of the watcher's write-stability delay. If the content already
            // matches what's loaded, just refresh mtimeMs — deliberately not
            // reloading/bumping version, since that would force-recreate the
            // live CodeMirror instance (destroying cursor/scroll/undo) for no
            // reason, and could stomp a scroll-to-line request from an
            // explicit navigation that raced with this same self-echoed event.
            const result = await window.knote.readFile(path)
            const cur = get().panes[pane]
            if (!cur?.note || !samePath(cur.note.path, path)) continue
            if (result.content === cur.note.content) {
              patchPane(pane, { note: { ...cur.note, mtimeMs: result.mtimeMs } })
            } else {
              await get().openFileInPane(pane, cur.note.path, cur.scrollRequest ?? undefined)
            }
          }
        }
      }
    }
  }
})

/**
 * Each pane's editor registers a flush callback here so "Keep my version"
 * can force-save that pane's live buffer (the store never holds the live
 * buffer).
 */
const keepMineCallbacks = new Map<number, () => void>()
export function registerKeepMine(pane: number, cb: (() => void) | null): void {
  if (cb) keepMineCallbacks.set(pane, cb)
  else keepMineCallbacks.delete(pane)
}
