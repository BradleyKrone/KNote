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
        <div className="confirm-message">{request.message}</div>
        <div className="confirm-actions">
          <button className="icon-btn confirm-btn" onClick={() => answer(false)}>
            Cancel
          </button>
          <button
            className={`icon-btn confirm-btn${request.danger ? ' confirm-btn-danger' : ''}`}
            onClick={() => answer(true)}
            autoFocus
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
