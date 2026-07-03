import { useEffect, useRef, useState } from 'react'

interface Props {
  anchorEl: HTMLElement | null
  onClose: () => void
  children: React.ReactNode
}

/** Small dropdown anchored below a trigger element. Closes on outside click / Escape. */
export function Popover({ anchorEl, onClose, children }: Props): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!anchorEl) return
    const rect = anchorEl.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left })
  }, [anchorEl])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (panelRef.current?.contains(e.target as Node)) return
      if (anchorEl?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorEl, onClose])

  if (!anchorEl || !pos) return null

  return (
    <div
      ref={panelRef}
      className="popover-panel"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}
