import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ARCHIVED_CHAR, DUE_RE, MILESTONE_LINE_RE, TASK_LINE_RE } from '@shared/parser/patterns'
import type { BoardColumn } from '@shared/types'
import { registerKeepMine, useWorkspaceStore } from '@/stores/workspaceStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { createEditor, type KnoteEditor } from './cmSetup'
import { setActiveEditorView } from './activeView'
import {
  adjustFontSize,
  insertCheckboxAtCursor,
  insertMilestoneAtCursor,
  insertTagAtCursor,
  setDueDateAtCursor,
  setPriorityAtCursor,
  setTaskStatusAtCursor,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleStrikethrough
} from './formatting'
import { ReadingView } from '@/components/reading/ReadingView'
import { ContextMenu, type MenuEntry } from '@/components/ContextMenu'
import { Popover } from '@/components/popover/Popover'
import { TagPickerContent } from '@/components/popover/TagPickerContent'
import { PriorityPickerContent } from '@/components/popover/PriorityPickerContent'
import { DatePickerContent } from '@/components/popover/DatePickerContent'

const AUTOSAVE_DELAY_MS = 500

interface ContextMenuState {
  x: number
  y: number
  isTask: boolean
  isMilestone: boolean
  isCheckbox: boolean
  spelling: SpellingTarget | null
}

interface SpellingTarget {
  word: string
  from: number
  to: number
  suggestions: string[]
}

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

const WORD_CHAR_RE = /[A-Za-z']/

/** Finds the word (if any) touching `pos`, for spellcheck suggestions on right-click. */
function wordAt(
  view: EditorView,
  pos: number
): { word: string; from: number; to: number } | null {
  const line = view.state.doc.lineAt(pos)
  const offset = pos - line.from
  if (!WORD_CHAR_RE.test(line.text[offset] ?? '') && !WORD_CHAR_RE.test(line.text[offset - 1] ?? '')) {
    return null
  }
  let start = offset
  while (start > 0 && WORD_CHAR_RE.test(line.text[start - 1])) start--
  let end = offset
  while (end < line.text.length && WORD_CHAR_RE.test(line.text[end])) end++
  if (start === end) return null
  return { word: line.text.slice(start, end), from: line.from + start, to: line.from + end }
}

function replaceWordWith(
  view: EditorView,
  target: { from: number; to: number },
  replacement: string
): void {
  view.dispatch({
    changes: { from: target.from, to: target.to, insert: replacement },
    selection: { anchor: target.from + replacement.length }
  })
  view.focus()
}

/** Spelling-suggestion entries shown above the regular formatting menu. */
function buildSpellingMenuItems(view: EditorView, target: SpellingTarget): MenuEntry[] {
  const items: MenuEntry[] = target.suggestions.slice(0, 5).map((s) => ({
    label: s,
    onClick: () => replaceWordWith(view, target, s)
  }))
  if (items.length === 0) items.push({ label: 'No suggestions', onClick: () => {} })
  items.push({
    label: 'Add to dictionary',
    onClick: () => void window.knote.spellcheck.addWord(target.word)
  })
  items.push({ separator: true })
  return items
}

type PickerKind = 'tag' | 'priority' | 'date'

interface ActivePicker {
  kind: PickerKind
  x: number
  y: number
}

/** Right-click landed on a task's checkbox glyph: offer a quick status switch instead of formatting. */
function buildCheckboxMenuItems(view: EditorView, columns: BoardColumn[]): MenuEntry[] {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const currentChar = TASK_LINE_RE.exec(line.text)?.[3] ?? null
  const items: MenuEntry[] = columns.map((col) => ({
    label: col.char === currentChar ? `✓ ${col.name}` : col.name,
    onClick: () => setTaskStatusAtCursor(view, col.char)
  }))
  items.push(
    { separator: true },
    {
      label: currentChar === ARCHIVED_CHAR ? '✓ Archived' : 'Archived',
      onClick: () => setTaskStatusAtCursor(view, ARCHIVED_CHAR)
    }
  )
  return items
}

function buildContextMenuItems(
  view: EditorView,
  ctx: ContextMenuState,
  openPicker: (kind: PickerKind) => void
): MenuEntry[] {
  const items: MenuEntry[] = ctx.spelling ? buildSpellingMenuItems(view, ctx.spelling) : []
  items.push(
    { label: 'Bold', onClick: () => toggleBold(view) },
    { label: 'Italic', onClick: () => toggleItalic(view) },
    { label: 'Strikethrough', onClick: () => toggleStrikethrough(view) },
    { label: 'Inline code', onClick: () => toggleInlineCode(view) },
    { separator: true },
    { label: 'Add checkbox', onClick: () => insertCheckboxAtCursor(view) },
    { label: 'Add milestone', onClick: () => insertMilestoneAtCursor(false) }
  )
  if (ctx.isTask || ctx.isMilestone) {
    items.push(
      { separator: true },
      { label: 'Add tag…', onClick: () => openPicker('tag') },
      { label: 'Set priority…', onClick: () => openPicker('priority') },
      { label: 'Set due date…', onClick: () => openPicker('date') }
    )
  }
  items.push(
    { separator: true },
    { label: 'Increase font size', onClick: () => adjustFontSize(view, 1) },
    { label: 'Decrease font size', onClick: () => adjustFontSize(view, -1) }
  )
  return items
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
    setContextMenu(null)
    setActivePicker(null)

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

  const currentLineDue = (): string | null => {
    const view = editorRef.current?.view
    if (!view) return null
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    const m = DUE_RE.exec(line.text)
    return m ? (m[1] ?? m[2]) : null
  }

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
        <Popover anchorPoint={{ x: activePicker.x, y: activePicker.y }} onClose={() => setActivePicker(null)}>
          {activePicker.kind === 'tag' && (
            <TagPickerContent
              onSelect={(tag) => {
                const view = editorRef.current?.view
                if (view) insertTagAtCursor(view, tag)
                setActivePicker(null)
              }}
            />
          )}
          {activePicker.kind === 'priority' && (
            <PriorityPickerContent
              onSelect={(level) => {
                const view = editorRef.current?.view
                if (view) setPriorityAtCursor(view, level)
                setActivePicker(null)
              }}
            />
          )}
          {activePicker.kind === 'date' && (
            <DatePickerContent
              currentDate={currentLineDue()}
              onSelect={(date) => {
                const view = editorRef.current?.view
                if (view) setDueDateAtCursor(view, date)
                setActivePicker(null)
              }}
            />
          )}
        </Popover>
      )}
    </div>
  )
}
