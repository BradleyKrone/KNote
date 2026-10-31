// Continuous horizontal dragging for the Gantt bars.
//
// Deliberately raw pointer events rather than @dnd-kit (which the board uses):
// dnd-kit resolves a *discrete* droppable and hands back a transform at drop,
// whereas a Gantt needs live px→day quantization, four separate grips on one
// bar, and correct arithmetic while the grid's own scrollLeft moves underneath
// the pointer mid-drag. Pointer capture keeps the gesture alive once the cursor
// leaves the bar, which is the normal case within a few pixels.
//
// Holding the pointer near either edge of the chart auto-scrolls it, so one
// drag can travel past what's on screen; the planner grows its date range to
// keep up (`widenDomain`).

import { useCallback, useEffect, useRef, useState } from 'react'
import { edgeScrollSpeed, pxToDays, type Zoom } from './plannerLayout'

export type DragMode = 'move' | 'resize-start' | 'resize-end' | 'link'

export interface DragState {
  id: string
  mode: DragMode
  /** Whole days the pointer has travelled — 0 for a link drag. */
  deltaDays: number
  /** Viewport point the pointer is at, for drawing the in-flight link line. */
  point: { x: number; y: number } | null
  /** Deliverable id currently under the pointer during a link drag. */
  targetId: string | null
}

interface Options {
  zoom: Zoom
  /** The horizontally scrolling grid element, so scroll during a drag is accounted for. */
  scrollRef: React.RefObject<HTMLElement>
  /** Width of the sticky pane covering the scroller's left side — the chart's visible left edge sits after it. */
  leftInset?: number
  onCommit: (state: DragState) => void
}

interface Origin {
  clientX: number
  scrollLeft: number
}

export interface BarDrag {
  drag: DragState | null
  /** Attach to a bar (or one of its grips) via onPointerDown. */
  start: (e: React.PointerEvent, id: string, mode: DragMode) => void
  /**
   * The grid's content moved right by `px` and was scrolled to match (the
   * date range grew to the left) — account for it so it doesn't read as drag.
   */
  rebase: (px: number) => void
}

/** Deliverable id of the bar under a viewport point, from its `data-deliverable` attribute. */
function deliverableAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)
  return el?.closest<HTMLElement>('[data-deliverable]')?.dataset.deliverable ?? null
}

export function useBarDrag({ zoom, scrollRef, leftInset = 0, onCommit }: Options): BarDrag {
  const [drag, setDrag] = useState<DragState | null>(null)
  const origin = useRef<Origin | null>(null)
  // Read in the pointerup handler, which is registered once and would
  // otherwise close over a stale drag state.
  const latest = useRef<DragState | null>(null)
  latest.current = drag
  // Last pointer position, for the auto-scroll loop: no pointermove fires
  // while the pointer is held still at the edge.
  const pointer = useRef<{ x: number; y: number } | null>(null)

  const start = useCallback(
    (e: React.PointerEvent, id: string, mode: DragMode) => {
      // Left button only: right-click opens the row's context menu.
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      origin.current = { clientX: e.clientX, scrollLeft: scrollRef.current?.scrollLeft ?? 0 }
      pointer.current = { x: e.clientX, y: e.clientY }
      setDrag({ id, mode, deltaDays: 0, point: { x: e.clientX, y: e.clientY }, targetId: null })
    },
    [scrollRef]
  )

  const active = drag !== null
  useEffect(() => {
    if (!active) return

    const recompute = (x: number, y: number): void => {
      const from = origin.current
      const mode = latest.current?.mode
      if (!from || !mode) return
      const scrolled = (scrollRef.current?.scrollLeft ?? 0) - from.scrollLeft
      const deltaDays = mode === 'link' ? 0 : pxToDays(x - from.clientX + scrolled, zoom)
      const targetId = mode === 'link' ? deliverableAt(x, y) : null
      setDrag((prev) => (prev ? { ...prev, deltaDays, point: { x, y }, targetId } : prev))
    }

    const onMove = (e: PointerEvent): void => {
      pointer.current = { x: e.clientX, y: e.clientY }
      recompute(e.clientX, e.clientY)
    }

    // Edge auto-scroll: every frame the pointer sits near (or past) an edge,
    // scroll that way and re-measure — the scrolled distance is part of the
    // drag, exactly as if the pointer had moved.
    let frame = 0
    const tick = (): void => {
      frame = requestAnimationFrame(tick)
      const el = scrollRef.current
      const at = pointer.current
      if (!el || !at) return
      const rect = el.getBoundingClientRect()
      const speed = edgeScrollSpeed(at.x, rect.left + leftInset, rect.right)
      if (speed === 0) return
      const before = el.scrollLeft
      el.scrollLeft += speed
      if (el.scrollLeft !== before) recompute(at.x, at.y)
    }
    frame = requestAnimationFrame(tick)

    const finish = (commit: boolean): void => {
      const state = latest.current
      cancelAnimationFrame(frame)
      origin.current = null
      pointer.current = null
      setDrag(null)
      if (commit && state) onCommit(state)
    }

    const onUp = (): void => finish(true)
    const onCancel = (): void => finish(false)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
    }
    // Keyed on *whether* a drag is running, not on the drag object: the
    // handlers read the live state through `latest`, so the listeners are
    // installed once per gesture instead of being rebuilt on every pointermove.
  }, [active, zoom, scrollRef, leftInset, onCommit])

  const rebase = useCallback((px: number) => {
    if (origin.current) origin.current.scrollLeft += px
  }, [])

  return { drag, start, rebase }
}
