import { useCallback, useEffect, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { registerKeepMine, useWorkspaceStore } from '@/stores/workspaceStore'
import { createEditor, type KnoteEditor } from './cmSetup'
import { setActiveEditorView } from './activeView'
import { ReadingView } from '@/components/reading/ReadingView'

const AUTOSAVE_DELAY_MS = 500

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

  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<KnoteEditor | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveInFlight = useRef(false)
  const savePending = useRef(false)
  const lastSaved = useRef<string | null>(null)

  // Refs so callbacks always see the latest path/eol even after a rename
  const pathRef = useRef(note?.path ?? '')
  const eolRef = useRef<'\n' | '\r\n'>(note?.eol ?? '\n')
  if (note) {
    pathRef.current = note.path
    eolRef.current = note.eol
  }

  const save = useCallback(async (force = false): Promise<void> => {
    const editor = editorRef.current
    if (!editor) return
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
    let content = editor.view.state.doc.toString()
    if (eolRef.current === '\r\n') content = content.replace(/\n/g, '\r\n')
    if (!force && content === lastSaved.current) return
    saveInFlight.current = true
    try {
      // Optimistic concurrency: refuse to clobber a file someone else wrote
      // since we loaded/saved it. Forced saves ("Keep my version") skip this.
      const expected = force ? undefined : useWorkspaceStore.getState().note?.mtimeMs
      const result = await window.knote.writeFile(pathRef.current, content, expected)
      lastSaved.current = content
      useWorkspaceStore.getState().markSaved(result.mtimeMs)
    } catch (err) {
      if (String(err).includes('KNOTE_CONFLICT')) {
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

    // Heading links request a scroll-to-line on open
    const scrollLine = useWorkspaceStore.getState().consumeScrollRequest()
    if (scrollLine !== null && scrollLine < editor.view.state.doc.lines) {
      const linePos = editor.view.state.doc.line(scrollLine + 1).from
      editor.view.dispatch({
        selection: { anchor: linePos },
        effects: EditorView.scrollIntoView(linePos, { y: 'start', yMargin: 60 })
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
      {isReading ? <ReadingView /> : <div ref={containerRef} className="editor-host" />}
    </div>
  )
}
