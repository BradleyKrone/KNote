/**
 * Drag-to-resize maths for the board's task editor (`TaskNoteDialog`).
 *
 * The overlay keeps the panel centered, so dragging one edge grows the panel
 * on *both* sides — an edge only travels half the size change. Doubling the
 * pointer delta is what keeps the grabbed edge under the cursor.
 */

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const RESIZE_EDGES: readonly ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

export interface Size {
  w: number
  h: number
}

export const MIN_DIALOG_SIZE: Size = { w: 480, h: 360 }
/** Gap kept between the panel and the viewport edge — matches the CSS
 *  `max-width: calc(100vw - 40px)` the default size already obeys. */
export const VIEWPORT_MARGIN = 40

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

export function resizeFromEdge(
  edge: ResizeEdge,
  start: Size,
  dx: number,
  dy: number,
  viewport: Size
): Size {
  let w = start.w
  let h = start.h
  if (edge.includes('e')) w += 2 * dx
  if (edge.includes('w')) w -= 2 * dx
  if (edge.includes('s')) h += 2 * dy
  if (edge.includes('n')) h -= 2 * dy
  // A viewport smaller than the minimum wins over the minimum: the panel must
  // never be dragged bigger than the window can show.
  const maxW = Math.max(viewport.w - VIEWPORT_MARGIN, 0)
  const maxH = Math.max(viewport.h - VIEWPORT_MARGIN, 0)
  return {
    w: Math.min(clamp(w, MIN_DIALOG_SIZE.w, maxW), maxW),
    h: Math.min(clamp(h, MIN_DIALOG_SIZE.h, maxH), maxH)
  }
}
