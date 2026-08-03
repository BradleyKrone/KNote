// The planner's "+ New" forms. Each one writes plain Markdown into a note —
// a project note, a deliverable line, an indented task, a 🏁 milestone — so
// nothing here creates state that only the planner can read.

import { useEffect, useRef, useState } from 'react'
import { addDays, today } from './plannerLayout'
import { FolderPicker } from './FolderPicker'

export type CreateKind = 'project' | 'deliverable' | 'task' | 'milestone'

export interface CreateRequest {
  kind: CreateKind
  /** Deliverable/task/milestone: which project or deliverable it goes under. */
  contextLabel: string
}

export interface CreateResult {
  name: string
  folder: string
  start: string
  end: string
  date: string
}

interface Props {
  request: CreateRequest
  /** Every folder that already exists in the vault, for the project folder browser. */
  folders?: readonly string[]
  /** Every note path, so the browser can show files alongside folders. */
  notePaths?: readonly string[]
  onCancel: () => void
  onSubmit: (result: CreateResult) => void
}

const TITLES: Record<CreateKind, string> = {
  project: 'New project',
  deliverable: 'New deliverable',
  task: 'New task',
  milestone: 'New milestone'
}

export function CreateDialog({
  request,
  folders = [],
  notePaths = [],
  onCancel,
  onSubmit
}: Props): React.JSX.Element {
  const [name, setName] = useState('')
  // Default to an existing "Projects" folder if the vault has one; otherwise
  // the root, so the picker never opens on a folder that isn't there.
  const [folder, setFolder] = useState(() => (folders.includes('Projects') ? 'Projects' : ''))
  const [start, setStart] = useState(today())
  const [end, setEnd] = useState(addDays(today(), 13))
  // Doubles as a milestone's date and a project's target end — a project
  // defaults to a quarter out, which is a nudge to set a real one, not a guess
  // it'll be held to.
  const [date, setDate] = useState(request.kind === 'project' ? addDays(today(), 90) : today())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [request])

  const canSubmit = name.trim().length > 0 && (request.kind !== 'deliverable' || start <= end)
  const submit = (): void => {
    if (!canSubmit) return
    onSubmit({ name: name.trim(), folder: folder.trim(), start, end, date })
  }

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-panel confirm-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="confirm-message">
          {TITLES[request.kind]}
          {request.contextLabel && <span className="board-scope"> in {request.contextLabel}</span>}
        </div>
        <input
          ref={inputRef}
          className="panel-input"
          placeholder={request.kind === 'project' ? 'Project name…' : 'Name…'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
        {request.kind === 'project' && (
          <FolderPicker
            folders={folders}
            notePaths={notePaths}
            value={folder}
            onChange={setFolder}
          />
        )}
        {request.kind === 'deliverable' && (
          <>
            <label className="reason-date-field">
              <span className="reason-date-label">Start</span>
              <input
                type="date"
                className="panel-input small"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="reason-date-field">
              <span className="reason-date-label">End</span>
              <input
                type="date"
                className="panel-input small"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </>
        )}
        {request.kind === 'project' && (
          <label className="reason-date-field">
            <span className="reason-date-label">Target end</span>
            <input
              type="date"
              className="panel-input small"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        )}
        {request.kind === 'milestone' && (
          <label className="reason-date-field">
            <span className="reason-date-label">Date</span>
            <input
              type="date"
              className="panel-input small"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        )}
        <div className="confirm-actions">
          <button className="icon-btn confirm-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="icon-btn confirm-btn" onClick={submit} disabled={!canSubmit}>
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
