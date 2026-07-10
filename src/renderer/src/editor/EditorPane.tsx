import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { MILESTONE_LINE_RE, TASK_LINE_RE } from '@shared/parser/patterns'
import { isConflictError } from '@shared/errors'
import { registerKeepMine, useWorkspaceStore } from '@/stores/workspaceStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { createEditor, type KnoteEditor } from './cmSetup'
import { setActiveEditorView } from './activeView'
import {
  buildCheckboxMenuItems,
  buildContextMenuItems,
  wordAt,
  type ContextMenuState,
  type SpellingTarget
} from './contextMenu'
import { EditorPickers, type ActivePicker } from './EditorPickers'
import { ReadingView } from '@/components/reading/ReadingView'
import { ContextMenu } from '@/components/ContextMenu'

const AUTOSAVE_DELAY_MS = 500

/** Editor state captured on right-click, paired with async spell data from main. */
interface PendingContext {
  x: number
  y: number
  isTask: boolean
  isMilestone: boolean
  isCheckbox: boolean
  /** The word range under the cursor (null on a checkbox or blank spot). */
  wordRange: { word: string; from: number; to: number } | null
}

/**
 * Hosts the CodeMirror view for the currently open note. The component is
 * keyed on the note path (remounts per note); external reloads bump
 * note.version, which rebuilds the editor buffer.
 */
export function EditorPane(): React.JSX.Element {
  const note = useWorkspaceStore((s) => s.note)
  const mode = useWorkspaceStore((s) => s.mode)
  const conflict = useWorkspaceStore((s) => s.conflict)
  const resolveConflict = useWorkspaceStore((s) => s.resolveConflict)
  const columns = useSettingsStore((s) => s.vaultConfig.columns)

  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<KnoteEditor | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveInFlight = useRef(false)
  const savePending = useRef(false)
  const lastSaved = useRef<string | null>(null)
  // Latest known buffer content, kept fresh on every doc change so a save
  // retry queued while the editor is being torn down (e.g. switching to the
  // Kanban board mid-save) still has content to write instead of silently
  // no-op'ing once editorRef.current goes null.
  const pendingContent = useRef<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [activePicker, setActivePicker] = useState<ActivePicker | null>(null)
  // Editor state captured on right-click (DOM event), consumed when the main
  // process delivers the matching spellcheck data a moment later.
  const pendingContext = useRef<PendingContext | null>(null)

  // Refs so callbacks always see the latest path/eol even after a rename
  const pathRef = useRef(note?.path ?? '')
  const eolRef = useRef<'\n' | '\r\n'>(note?.eol ?? '\n')
  if (note) {
    pathRef.current = note.path
    eolRef.current = note.eol
  }

  const save = useCallback(async (force = false): Promise<void> => {
    const editor = editorRef.current
    let content: string
    if (editor) {
      content = editor.view.state.doc.toString()
      if (eolRef.current === '\r\n') content = content.replace(/\n/g, '\r\n')
      pendingContent.current = content
    } else if (pendingContent.current !== null) {
      // Editor already destroyed (e.g. this is a queued retry that fired
      // after the user navigated away mid-save) — use the last buffer
      // content captured before teardown instead of silently dropping it.
      content = pendingContent.current
    } else {
      return
    }
    // While a conflict is unresolved, never auto-write over the external edit
    if (!force && useWorkspaceStore.getState().conflict) return
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (saveInFlight.current) {
      savePending.current = true
      return
    }
    if (!force && content === lastSaved.current) return
    saveInFlight.current = true
    try {
      // Optimistic concurrency: refuse to clobber a file someone else wrote
      // since we loaded/saved it. Forced saves ("Keep my version") skip this.
      const expected = force ? undefined : useWorkspaceStore.getState().note?.mtimeMs
      const result = await window.knote.writeFile(pathRef.current, content, expected)
      lastSaved.current = content
      pendingContent.current = null
      useWorkspaceStore.getState().markSaved(content, result.mtimeMs)
    } catch (err) {
      if (isConflictError(err)) {
        useWorkspaceStore.getState().setConflict('modified')
      } else {
        console.error('Save failed:', err)
      }
    } finally {
      saveInFlight.current = false
      if (savePending.current) {
        savePending.current = false
        void save(force)
      }
    }
  }, [])

  const scheduleSave = useCallback(
    (flushNow: boolean): void => {
      useWorkspaceStore.getState().markDirty()
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (flushNow) {
        void save()
      } else {
        saveTimer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS)
      }
    },
    [save]
  )

  // (Re)create the editor when the note buffer is (re)loaded from disk
  const version = note?.version ?? 0
  const isReading = mode === 'reading'
  useEffect(() => {
    if (!note || !containerRef.current || isReading) return
    // note.content is the on-disk representation (CRLF preserved)
    lastSaved.current = note.content
    const editor = createEditor(
      containerRef.current,
      // CM normalizes to \n internally; eol is restored on save
      note.content,
      useWorkspaceStore.getState().mode === 'live',
      {
        getPath: () => pathRef.current,
        onDocChanged: scheduleSave
      }
    )
    editorRef.current = editor
    editor.view.focus()
    setActiveEditorView(editor.view)
    setContextMenu(null)
    setActivePicker(null)

    // Heading links / board cards request a scroll-to-line on open. Peek the
    // request without clearing it: under React StrictMode this create effect
    // runs twice on a fresh mount (create → destroy → create), and clearing
    // in the first, discarded run would leave the second, live editor with
    // nothing to scroll to. It's cleared below, only by the surviving editor.
    const scrollLine = useWorkspaceStore.getState().scrollRequest
    if (scrollLine !== null) {
      const scrollToTarget = (): void => {
        // Editor may have been torn down (StrictMode / fast re-nav) before this
        // ran — only the currently-live editor should act on the request.
        if (editorRef.current !== editor) return
        if (scrollLine >= editor.view.state.doc.lines) return
        const linePos = editor.view.state.doc.line(scrollLine + 1).from
        editor.view.dispatch({
          selection: { anchor: linePos },
          effects: EditorView.scrollIntoView(linePos, { y: 'start', yMargin: 60 })
        })
      }
      // Do it now for the warm case (editor already laid out — e.g. re-opening
      // the note already behind the board). On a fresh remount the container
      // was just inserted and CodeMirror hasn't measured line heights yet, so
      // this first dispatch scrolls against *estimated* heights and lands at
      // the top; re-issue on the next frame, once the browser has laid the
      // container out for real, so the target line is exact. The surviving
      // editor also clears the request so a later reading-mode toggle (which
      // re-runs this effect) doesn't jump back to the same line.
      scrollToTarget()
      requestAnimationFrame(() => {
        scrollToTarget()
        if (editorRef.current === editor) {
          useWorkspaceStore.getState().clearScrollRequest()
        }
      })
    }
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      // Flush any unsaved edits before tearing down (fire and forget)
      if (useWorkspaceStore.getState().dirty && !useWorkspaceStore.getState().conflict) {
        void save()
      }
      editorRef.current = null
      setActiveEditorView(null)
      editor.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, isReading, scheduleSave, save])

  // Live preview <-> source mode toggle
  useEffect(() => {
    if (!isReading) editorRef.current?.setLivePreview(mode === 'live')
  }, [mode, version, isReading])

  // Entering reading mode: wait for the flushed save, then refresh the
  // content from disk so the reading view never shows a stale buffer.
  useEffect(() => {
    if (!isReading) return
    let cancelled = false
    void (async () => {
      for (let i = 0; i < 20 && saveInFlight.current; i++) {
        await new Promise((r) => setTimeout(r, 100))
      }
      const current = useWorkspaceStore.getState().note
      if (cancelled || !current) return
      const fresh = await window.knote.readFile(current.path)
      if (!cancelled && fresh.content !== current.content) {
        await useWorkspaceStore.getState().openFile(current.path)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isReading])

  // "Keep my version" in the conflict banner force-saves the live buffer
  useEffect(() => {
    registerKeepMine(() => void save(true))
    return () => registerKeepMine(null)
  }, [save])

  // Flush on app close
  useEffect(() => {
    const flush = (): void => {
      if (useWorkspaceStore.getState().dirty) void save()
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [save])

  // Right-click records where/what was clicked but does NOT open the menu or
  // preventDefault — letting the event through is what lets Chromium fire its
  // main-process context-menu event (with spellcheck data). The menu opens when
  // that data arrives, in the effect below.
  const handleContextMenu = useCallback((e: React.MouseEvent): void => {
    const editor = editorRef.current
    if (!editor) return
    const view = editor.view
    const isCheckbox = !!(e.target as HTMLElement).closest?.('.knote-task-checkbox')
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos !== null) {
      const insideSelection = view.state.selection.ranges.some(
        (r) => pos >= r.from && pos <= r.to
      )
      if (!insideSelection) view.dispatch({ selection: EditorSelection.cursor(pos) })
    }
    const line = view.state.doc.lineAt(pos ?? view.state.selection.main.head)
    pendingContext.current = {
      x: e.clientX,
      y: e.clientY,
      isTask: TASK_LINE_RE.test(line.text),
      isMilestone: MILESTONE_LINE_RE.test(line.text),
      isCheckbox,
      wordRange: !isCheckbox && pos !== null ? wordAt(view, pos) : null
    }
  }, [])

  // Main process delivers the spellcheck result for the last right-click; pair
  // it with the editor context captured above and open the styled menu.
  useEffect(() => {
    return window.knote.onSpellContextMenu((info) => {
      const ctx = pendingContext.current
      if (!ctx || !editorRef.current) return
      const spelling: SpellingTarget | null =
        info.misspelledWord && ctx.wordRange
          ? { ...ctx.wordRange, word: info.misspelledWord, suggestions: info.dictionarySuggestions }
          : null
      setContextMenu({
        x: ctx.x,
        y: ctx.y,
        isTask: ctx.isTask,
        isMilestone: ctx.isMilestone,
        isCheckbox: ctx.isCheckbox,
        spelling
      })
    })
  }, [])

  if (!note) return <></>

  return (
    <div className="editor-pane">
      {conflict && (
        <div className="conflict-banner">
          <span>
            {conflict === 'deleted'
              ? 'This note was deleted outside KNote while you had unsaved changes.'
              : 'This note was changed outside KNote while you had unsaved changes.'}
          </span>
          <div className="conflict-actions">
            {conflict === 'modified' && (
              <button onClick={() => void resolveConflict('reload')}>Reload from disk</button>
            )}
            <button onClick={() => void resolveConflict('keep')}>Keep my version</button>
          </div>
        </div>
      )}
      {isReading ? (
        <ReadingView />
      ) : (
        <div ref={containerRef} className="editor-host" onContextMenu={handleContextMenu} />
      )}
      {contextMenu && editorRef.current && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={
            contextMenu.isCheckbox
              ? buildCheckboxMenuItems(editorRef.current.view, columns)
              : buildContextMenuItems(editorRef.current.view, contextMenu, (kind) =>
                  setActivePicker({ kind, x: contextMenu.x, y: contextMenu.y })
                )
          }
          onClose={() => setContextMenu(null)}
        />
      )}
      {activePicker && (
        <EditorPickers
          picker={activePicker}
          getView={() => editorRef.current?.view ?? null}
          onClose={() => setActivePicker(null)}
        />
      )}
    </div>
  )
}
