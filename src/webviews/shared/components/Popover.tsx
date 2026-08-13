import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const VIEWPORT_MARGIN = 8

interface Props {
  /** Anchor below this trigger element. Mutually exclusive with anchorPoint. */
  anchorEl?: HTMLElement | null
  /** Anchor at a raw viewport point (e.g. a right-click location) instead of an element. */
  anchorPoint?: { x: number; y: number } | null
  onClose: () => void
  children: React.ReactNode
}

/** Small dropdown anchored below a trigger element or at a point. Closes on outside click / Escape. */
export function Popover({
  anchorEl,
  anchorPoint,
  onClose,
  children
}: Props): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const clamped = useRef(false)

  useEffect(() => {
    clamped.current = false
    if (anchorPoint) {
      setPos({ top: anchorPoint.y, left: anchorPoint.x })
      return
    }
    if (!anchorEl) return
    const rect = anchorEl.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left })
  }, [anchorEl, anchorPoint])

  useLayoutEffect(() => {
    if (!pos || clamped.current) return
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    const overflowX = rect.right - (window.innerWidth - VIEWPORT_MARGIN)
    const overflowY = rect.bottom - (window.innerHeight - VIEWPORT_MARGIN)
    clamped.current = true
    if (overflowX > 0 || overflowY > 0) {
      setPos((prev) =>
        prev
          ? {
              top: overflowY > 0 ? Math.max(VIEWPORT_MARGIN, prev.top - overflowY) : prev.top,
              left: overflowX > 0 ? Math.max(VIEWPORT_MARGIN, prev.left - overflowX) : prev.left
            }
          : prev
      )
    }
  }, [pos])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (panelRef.current?.contains(e.target as Node)) return
      if (anchorEl?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Capture, not bubble: callers around the app (drag handles, the modal
    // overlay) call stopPropagation on their own mousedown/pointerdown
    // handlers, which would otherwise swallow the event before it ever
    // bubbles up to a plain document listener — leaving an outside click
    // unable to close the popover at all.
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorEl, onClose])

  if ((!anchorEl && !anchorPoint) || !pos) return null

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
