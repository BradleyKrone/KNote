import { useEffect, useRef, useState } from 'react'
import { withoutAnchor } from '@shared/blockAnchor'
import { noteBodyToText } from '@shared/parser/taskNoteBody'
import { TaskMetaToolbar } from '../shared/components/TaskMetaToolbar'
import { confirm } from '../shared/stores'
import { updateCardNote } from './boardActions'
import { useTaskNoteStore } from './taskNoteStore'

/**
 * The board's task editor: a task's line text and its whole attached note block
 * in one dialog, saved as one verified edit.
 *
 * Mounted once at the board root rather than per card, for two reasons:
 * `.modal-overlay` is `position: fixed`, and a card sits inside a column that
 * dnd-kit gives a `transform` during drag — a transformed ancestor would make
 * the overlay position against the column and clip it. And cards are keyed by
 * note path + line, so any edit that shifts line numbers in that note (this
 * dialog's own save, whenever the block grows) remounts the card and would tear
 * an open dialog down mid-edit.
 */
export function TaskNoteDialog(): React.JSX.Element | null {
  const card = useTaskNoteStore((s) => s.card)
  const close = useTaskNoteStore((s) => s.close)
  const [taskText, setTaskText] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const initial = useRef({ taskText: '', body: '' })
  const taskRef = useRef<HTMLTextAreaElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!card) return
    // Without the `^anchor` — it's link plumbing, not task text, and tidying it
    // away here would break every link pointing at this task. The save puts it
    // back.
    const text = withoutAnchor(card.text)
    const noteText = noteBodyToText(card.noteLines)
    setTaskText(text)
    setBody(noteText)
    setSaving(false)
    initial.current = { taskText: text, body: noteText }
    // The notes box is what the pencil is now for; the task line is one Tab away.
    setTimeout(() => bodyRef.current?.focus(), 0)
  }, [card])

  if (!card) return null

  const dirty = taskText !== initial.current.taskText || body !== initial.current.body

  const requestClose = (): void => {
    if (!dirty) return close()
    void confirm('Discard your changes to this task?').then((ok) => {
      if (ok) close()
    })
  }

  const save = (): void => {
    if (saving) return
    setSaving(true)
    void updateCardNote(card, taskText, body).then(
      (ok) => {
        // A stale refusal wrote nothing, so the dialog stays put holding the
        // user's text rather than throwing it away.
        if (ok) close()
        else setSaving(false)
      },
      () => setSaving(false)
    )
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
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
        <div className="task-note-title">Edit task</div>
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

        <div className="task-note-meta">
          <span>
            Status Changed: <b>{card.statusChanged ?? '—'}</b>
          </span>
          <span>
            Date Entered: <b>{card.dateEntered ?? '—'}</b>
          </span>
          {card.waitingReason && (
            <span>
              Waiting: <b>{card.waitingReason}</b>
              {card.waitingFollowUp ? ` ⏳ ${card.waitingFollowUp}` : ''}
            </span>
          )}
        </div>

        <label className="task-note-body-label" htmlFor="task-note-body">
          Notes
        </label>
        <textarea
          id="task-note-body"
          ref={bodyRef}
          className="panel-input task-note-body"
          value={body}
          placeholder="- Notes: …"
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="task-note-hint">
          Status Changed, Date Entered and Waiting reasons are managed by KNote — edit them from the
          board, not here. <b>Ctrl/Cmd+Enter</b> saves.
        </div>

        <div className="confirm-actions">
          <button className="icon-btn confirm-btn" onClick={requestClose}>
            Cancel
          </button>
          <button className="icon-btn confirm-btn" onClick={save} disabled={saving}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
