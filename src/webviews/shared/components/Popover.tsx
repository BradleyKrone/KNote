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
  // Where the caller asked for the panel, and where it actually sits once
  // kept inside the viewport.
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (anchorPoint) {
      setAnchor({ top: anchorPoint.y, left: anchorPoint.x })
      return
    }
    if (!anchorEl) return
    const rect = anchorEl.getBoundingClientRect()
    setAnchor({ top: rect.bottom + 4, left: rect.left })
  }, [anchorEl, anchorPoint])

  // Re-fit whenever the panel's size changes, not just on first layout: the
  // editor's right-click menu swaps its small item list for a much taller
  // picker inside the same Popover, and a picker can grow as it's filled in.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!anchor || !panel) return
    const place = (): void => {
      const { width, height } = panel.getBoundingClientRect()
      const top = Math.max(
        VIEWPORT_MARGIN,
        Math.min(anchor.top, window.innerHeight - VIEWPORT_MARGIN - height)
      )
      const left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(anchor.left, window.innerWidth - VIEWPORT_MARGIN - width)
      )
      setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }))
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(panel)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [anchor])

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

  const at = pos ?? anchor
  if ((!anchorEl && !anchorPoint) || !at) return null

  return (
    <div
      ref={panelRef}
      className="popover-panel"
      style={{ top: at.top, left: at.left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}
