import { useEffect, useRef, useState } from 'react'
import { defaultReasonDate, useReasonPromptStore } from '../stores'

export function ReasonDialog(): React.JSX.Element | null {
  const request = useReasonPromptStore((s) => s.request)
  const answer = useReasonPromptStore((s) => s.answer)
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(defaultReasonDate())
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!request) return
    setReason('')
    setDate(defaultReasonDate())
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [request])

  if (!request) return null

  const canSubmit = reason.trim().length > 0 && date.length > 0

  const submit = (): void => {
    if (!canSubmit) return
    answer({ date, reason: reason.trim() })
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
          <span className="reason-date-label">Since</span>
          <input
            type="date"
            className="panel-input small"
            value={date}
            onChange={(e) => setDate(e.target.value)}
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
