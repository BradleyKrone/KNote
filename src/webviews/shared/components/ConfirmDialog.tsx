import { useEffect } from 'react'
import { useConfirmStore } from '../stores'

export function ConfirmDialog(): React.JSX.Element | null {
  const request = useConfirmStore((s) => s.request)
  const answer = useConfirmStore((s) => s.answer)

  useEffect(() => {
    if (!request) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') answer(false)
      else if (e.key === 'Enter') answer(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, answer])

  if (!request) return null

  return (
    <div className="modal-overlay" onMouseDown={() => answer(false)}>
      <div className="modal-panel confirm-panel" onMouseDown={(e) => e.stopPropagation()}>
        {request.title && <div className="confirm-title">{request.title}</div>}
        <div className="confirm-message">{request.message}</div>
        {request.changes && request.changes.length > 0 && (
          <div className="confirm-changes">
            {request.changes.map((c) => (
              <div key={c.label} className="confirm-change">
                <span className="confirm-change-label">{c.label}</span>
                <span className="confirm-change-from">{c.from}</span>
                <span className="confirm-change-arrow">→</span>
                <span className="confirm-change-to">{c.to}</span>
              </div>
            ))}
          </div>
        )}
        <div className="confirm-actions">
          <button className="icon-btn confirm-btn" onClick={() => answer(false)}>
            {request.cancelLabel}
          </button>
          <button
            className={`icon-btn confirm-btn${request.danger ? ' confirm-btn-danger' : ''}${request.primary ? ' confirm-btn-primary' : ''}`}
            onClick={() => answer(true)}
            autoFocus
          >
            {request.okLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
