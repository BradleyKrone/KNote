import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '@/stores/uiStore'
import { quickCapture } from '@/commands/weeklyNotes'

export function QuickCapture(): React.JSX.Element | null {
  const open = useUiStore((s) => s.quickCaptureOpen)
  const setOpen = useUiStore((s) => s.setQuickCaptureOpen)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setText('')
      setSubmitting(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  if (!open) return null

  const submit = async (): Promise<void> => {
    if (submitting || !text.trim()) return
    setSubmitting(true)
    await quickCapture(text)
    setOpen(false)
  }

  return (
    <div className="modal-overlay" onMouseDown={() => setOpen(false)}>
      <div className="modal-panel" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="modal-input"
          placeholder="Quick capture… appends to this week's note"
          value={text}
          disabled={submitting}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            else if (e.key === 'Enter') void submit()
          }}
        />
      </div>
    </div>
  )
}
