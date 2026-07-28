import { useEffect, useRef, useState } from 'react'
import { defaultFollowUpDate, useReasonPromptStore } from '../stores'

export function ReasonDialog(): React.JSX.Element | null {
  const request = useReasonPromptStore((s) => s.request)
  const answer = useReasonPromptStore((s) => s.answer)
  const [reason, setReason] = useState('')
  const [followUp, setFollowUp] = useState(defaultFollowUpDate())
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!request) return
    setReason('')
    setFollowUp(defaultFollowUpDate())
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [request])

  if (!request) return null

  // Both fields are mandatory: a parked task with no reason and no date to
  // come back to it is exactly what this prompt exists to prevent.
  const canSubmit = reason.trim().length > 0 && followUp.length > 0

  const submit = (): void => {
    if (!canSubmit) return
    answer({ followUp, reason: reason.trim() })
  }

  return (
    <div className="modal-overlay" onMouseDown={() => answer(null)}>
      <div className="modal-panel confirm-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="confirm-message">
          Why is this moving to <strong>{request.columnName}</strong>?
        </div>
        <textarea
          ref={textareaRef}
          className="panel-input reason-input"
          rows={3}
          placeholder="Reason…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') answer(null)
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <label className="reason-date-field">
          <span className="reason-date-label">Follow up</span>
          <input
            type="date"
            className="panel-input small"
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
          />
        </label>
        <div className="confirm-actions">
          <button className="icon-btn confirm-btn" onClick={() => answer(null)}>
            Cancel
          </button>
          <button className="icon-btn confirm-btn" onClick={submit} disabled={!canSubmit}>
            Move task
          </button>
        </div>
      </div>
    </div>
  )
}
