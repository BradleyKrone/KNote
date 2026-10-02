import { describe, expect, it } from 'vitest'
import {
  MIN_DIALOG_SIZE,
  resizeFromEdge,
  VIEWPORT_MARGIN
} from '../src/webviews/board/dialogResize'

const start = { w: 820, h: 600 }
const viewport = { w: 2000, h: 1400 }

describe('resizeFromEdge', () => {
  it('doubles the delta so the grabbed edge tracks the cursor of a centered panel', () => {
    expect(resizeFromEdge('e', start, 50, 0, viewport)).toEqual({ w: 920, h: 600 })
    expect(resizeFromEdge('w', start, -50, 0, viewport)).toEqual({ w: 920, h: 600 })
    expect(resizeFromEdge('s', start, 0, 30, viewport)).toEqual({ w: 820, h: 660 })
    expect(resizeFromEdge('n', start, 0, -30, viewport)).toEqual({ w: 820, h: 660 })
  })

  it('an edge ignores the other axis; a corner moves both', () => {
    expect(resizeFromEdge('e', start, 50, 999, viewport)).toEqual({ w: 920, h: 600 })
    expect(resizeFromEdge('se', start, 50, 30, viewport)).toEqual({ w: 920, h: 660 })
    expect(resizeFromEdge('nw', start, -50, -30, viewport)).toEqual({ w: 920, h: 660 })
    expect(resizeFromEdge('ne', start, 50, -30, viewport)).toEqual({ w: 920, h: 660 })
    expect(resizeFromEdge('sw', start, -50, 30, viewport)).toEqual({ w: 920, h: 660 })
  })

  it('clamps to the minimum size', () => {
    expect(resizeFromEdge('se', start, -1000, -1000, viewport)).toEqual(MIN_DIALOG_SIZE)
  })

  it('clamps to the viewport minus its margin', () => {
    expect(resizeFromEdge('se', start, 5000, 5000, viewport)).toEqual({
      w: viewport.w - VIEWPORT_MARGIN,
      h: viewport.h - VIEWPORT_MARGIN
    })
  })

  it('a viewport smaller than the minimum still wins', () => {
    expect(resizeFromEdge('e', start, 10, 0, { w: 400, h: 300 })).toEqual({ w: 360, h: 260 })
  })
})
