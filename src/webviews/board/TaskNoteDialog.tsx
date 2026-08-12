import { useEffect, useRef, useState } from 'react'
import { Prec } from '@codemirror/state'
import { EditorView, keymap, tooltips } from '@codemirror/view'
import { withoutAnchor } from '@shared/blockAnchor'
import { formatReasonLine } from '@shared/parser/patterns'
import { noteBodyToText } from '@shared/parser/taskNoteBody'
import { EditorContextMenu } from '../editor/EditorContextMenu'
import { setNotePath } from '../editor/knoteConstructs'
import { createEditor } from '../editor/setupEditor'
import { TaskMetaToolbar } from '../shared/components/TaskMetaToolbar'
import { confirm, promptReason } from '../shared/stores'
import { addCard, updateCardNote } from './boardActions'
import { useTaskNoteStore } from './taskNoteStore'

/**
 * The board's task editor: a task's line text and its whole attached block —
 * its notes, its sub-tasks, their notes, everything nested under it — in one
 * dialog, saved as one verified edit.
 *
 * The block is edited in the same CodeMirror live-preview editor a note uses,
 * in `fragment` mode: a detached, dedented buffer this dialog owns. Nothing is
 * written until Save, so ticking a sub-task here is a pending change like any
 * other keystroke — undoable, and thrown away on Cancel. See `editorKind` for
 * what else that mode changes.
 *
 * Mounted once at the board root rather than per card, for two reasons:
 * `.modal-overlay` is `position: fixed`, and a card sits inside a column that
 * dnd-kit gives a `transform` during drag — a transformed ancestor would make
 * the overlay position against the column and clip it. And cards are keyed by
 * note path + line, so any edit that shifts line numbers in that note (this
 * dialog's own save, whenever the block grows) remounts the card and would tear
 * an open dialog down mid-edit.
 *
 * Doubles as the "Add card" dialog: `target.kind === 'create'` composes a
 * brand-new task for a column instead of editing an existing one — nothing is
 * written to disk until Save, which is what makes it safe to open the full
 * editor straight from the "Add card" button rather than a one-line inline
 * input first.
 */
export function TaskNoteDialog(): React.JSX.Element | null {
  const target = useTaskNoteStore((s) => s.target)
  const close = useTaskNoteStore((s) => s.close)
  const [taskText, setTaskText] = useState('')
  const [bodyDirty, setBodyDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  // State, not just a ref: the context menu is a React component that needs the
  // view, so its first render has to wait for the editor to exist.
  const [view, setView] = useState<EditorView | null>(null)
  const initial = useRef({ taskText: '' })
  const taskRef = useRef<HTMLTextAreaElement>(null)
  const cmHost = useRef<HTMLDivElement>(null)
  // The keymap below is built once per card, but `save` closes over state that
  // changes on every keystroke — the ref is what keeps Ctrl+Enter from firing a
  // stale one without rebuilding the editor.
  const saveRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!target || !cmHost.current) return
    // Without the `^anchor` — it's link plumbing, not task text, and tidying it
    // away here would break every link pointing at this task. The save puts it
    // back. A brand-new card starts blank.
    const text = target.kind === 'edit' ? withoutAnchor(target.card.text) : ''
    setTaskText(text)
    setBodyDirty(false)
    setSaving(false)
    initial.current = { taskText: text }
    // Images, embeds and wiki links in the block resolve relative to the note
    // the card lives in, not to whatever note the board was opened from. A
    // new card scoped to the global/folder board has no note yet — it'll
    // land in this week's note, unknown until Save — so links stay unresolved.
    if (target.kind === 'edit') {
      setNotePath(target.card.path)
    } else {
      setNotePath(target.scope.kind === 'note' ? target.scope.path : null)
    }
    const created = createEditor({
      parent: cmHost.current,
      doc: target.kind === 'edit' ? noteBodyToText(target.card.blockLines) : '',
      kind: 'fragment',
      extensions: [
        // Completion popups and hover previews hang off document.body rather
        // than the editor: `.task-note-cm` clips its overflow so a wide table
        // scrolls instead of widening the dialog, and an in-editor tooltip
        // would be cut off at that same edge.
        tooltips({ parent: document.body }),
        // Above defaultKeymap, which binds Mod-Enter to insertBlankLine and
        // always claims it.
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                saveRef.current()
                return true
              }
            }
          ])
        ),
        // One flag, not a mirror of the text: the doc is read at save time. The
        // repeated `true` is a no-op re-render, so this costs one.
        EditorView.updateListener.of((u) => {
          if (u.docChanged) setBodyDirty(true)
        })
      ]
    })
    setView(created)
    // The block is what the pencil is now for; the task line is one Tab away.
    created.focus()
    return () => {
      created.destroy()
      setView(null)
      setNotePath(null)
    }
  }, [target])

  if (!target) return null

  const dirty = taskText !== initial.current.taskText || bodyDirty

  const requestClose = (): void => {
    if (!dirty) return close()
    void confirm('Discard your changes to this task?').then((ok) => {
      if (ok) close()
    })
  }

  const save = (): void => {
    if (saving) return
    if (target.kind === 'edit') {
      setSaving(true)
      void updateCardNote(target.card, taskText, view?.state.doc.toString() ?? '').then(
        (ok) => {
          // A stale refusal wrote nothing, so the dialog stays put holding the
          // user's text rather than throwing it away.
          if (ok) close()
          else setSaving(false)
        },
        () => setSaving(false)
      )
      return
    }
    // Create mode: nothing exists on disk yet, so an empty task text means
    // there's nothing to create — closing is enough, same as the old inline
    // add input discarding a blank entry.
    const text = taskText.trim()
    if (!text) return close()
    const bodyText = view?.state.doc.toString() ?? ''
    const { scope, column } = target
    const finish = (reasonLine?: string): void => {
      setSaving(true)
      void addCard(scope, column.char, text, bodyText, reasonLine).then(
        () => close(),
        () => setSaving(false)
      )
    }
    if (column.requireReason) {
      void promptReason(column.name).then((result) => {
        if (result) finish(formatReasonLine('  ', column.name, result.reason, result.followUp))
      })
    } else {
      finish()
    }
  }
  saveRef.current = save

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // CodeMirror calls preventDefault when one of its own keymaps consumed the
    // key: an autocomplete popup dismissing, the find panel closing, a
    // multi-range selection collapsing, its Mod-Enter save above. Escape
    // belongs to whichever of those is open — only one nothing else wanted
    // closes the dialog.
    if (e.defaultPrevented) return
    if (e.key === 'Escape') {
      // A picker popover listens for Escape on the document too; while one is
      // open it should close alone, not take the whole dialog with it.
      if (document.querySelector('.popover-panel')) return
      e.preventDefault()
      requestClose()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      save()
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={requestClose}>
      <div
        className="modal-panel task-note-panel"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="task-note-title">
          {target.kind === 'edit' ? 'Edit task' : `New task — ${target.column.name}`}
        </div>
        <TaskMetaToolbar value={taskText} onChange={setTaskText} textareaRef={taskRef} />
        <textarea
          ref={taskRef}
          className="panel-input task-note-line"
          rows={2}
          value={taskText}
          placeholder="Task text — add #tags, 📅 2026-07-15, !! priority…"
          onChange={(e) => setTaskText(e.target.value)}
          onKeyDown={(e) => {
            // A task line can't hold a newline, so plain Enter saves here —
            // same as the old inline editor. In the notes box it must not.
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault()
              save()
            }
          }}
        />

        {target.kind === 'edit' && (
          <div className="task-note-meta">
            <span>
              Status Changed: <b>{target.card.statusChanged ?? '—'}</b>
            </span>
            <span>
              Date Entered: <b>{target.card.dateEntered ?? '—'}</b>
            </span>
            {target.card.waitingReason && (
              <span>
                Waiting: <b>{target.card.waitingReason}</b>
                {target.card.waitingFollowUp ? ` ⏳ ${target.card.waitingFollowUp}` : ''}
              </span>
            )}
          </div>
        )}

        <div className="task-note-body-label">Notes &amp; sub-tasks</div>
        <div className="task-note-cm" ref={cmHost} />
        {/* The editor's own right-click menu — formatting, spell suggestions,
            table ops, sub-task toggles. The board already mounts ReasonDialog
            and Toast at its root, so only the menu is needed here. */}
        {view && <EditorContextMenu view={view} />}
        <div className="task-note-hint">
          {target.kind === 'edit' ? (
            <>
              Everything under the task, sub-tasks and all — tick one here and it saves with the
              rest. This task&apos;s own Status Changed, Date Entered and Waiting reason are managed
              by KNote and shown above; a sub-task&apos;s own stamps live in the editor and are
              kept. <b>Ctrl/Cmd+Enter</b> saves.
            </>
          ) : (
            <>
              Sub-tasks typed here are created along with the task, in one go. <b>Ctrl/Cmd+Enter</b>{' '}
              creates it.
            </>
          )}
        </div>

        <div className="confirm-actions">
          <button className="icon-btn confirm-btn" onClick={requestClose}>
            Cancel
          </button>
          <button className="icon-btn confirm-btn" onClick={save} disabled={saving}>
            {target.kind === 'edit' ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
