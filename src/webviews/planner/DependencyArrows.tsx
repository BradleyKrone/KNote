// Finish-to-start dependency connectors, drawn as one absolutely-positioned
// SVG overlay above the grid (and, during a link drag, the rubber-band line
// that follows the pointer).

import {
  arrowPath,
  dateToX,
  diffDays,
  PX_PER_DAY,
  rowCenter,
  type Domain,
  type Zoom
} from './plannerLayout'
import type { PlannerModel } from './plannerSelectors'

const BAR_HEIGHT = 18

export interface Span {
  start: string
  end: string
}

interface Props {
  model: PlannerModel
  rowIndex: ReadonlyMap<string, number>
  /** Row offsets, so arrows follow the gaps between projects. */
  tops: readonly number[]
  /** Preview spans during a drag, so the arrows track the bars they connect. */
  spanFor: (id: string) => Span
  domain: Domain
  zoom: Zoom
  width: number
  height: number
  violated: ReadonlySet<string>
  /** Extra SVG content drawn in the same overlay — the in-flight link line. */
  children?: React.ReactNode
}

export function DependencyArrows({
  model,
  rowIndex,
  tops,
  spanFor,
  domain,
  zoom,
  width,
  height,
  violated,
  children
}: Props): React.JSX.Element {
  const paths: React.JSX.Element[] = []
  for (const d of model.byId.values()) {
    const toRow = rowIndex.get(d.id)
    if (toRow === undefined) continue
    for (const predId of d.dependsOn) {
      const fromRow = rowIndex.get(predId)
      const pred = model.byId.get(predId)
      // Both ends have to be on screen: a collapsed project hides its rows.
      if (fromRow === undefined || !pred) continue
      const predSpan = spanFor(predId)
      const span = spanFor(d.id)
      const fromX =
        dateToX(domain, predSpan.start, zoom) +
        Math.max(PX_PER_DAY[zoom], (diffDays(predSpan.start, predSpan.end) + 1) * PX_PER_DAY[zoom])
      const toX = dateToX(domain, span.start, zoom)
      paths.push(
        <path
          key={`${predId}->${d.id}`}
          className={`planner-arrow${violated.has(d.id) ? ' violated' : ''}`}
          d={arrowPath(fromX, rowCenter(tops, fromRow), toX, rowCenter(tops, toRow), BAR_HEIGHT)}
          markerEnd="url(#planner-arrowhead)"
        />
      )
    }
  }

  return (
    <svg className="planner-arrows" width={width} height={height}>
      <defs>
        <marker
          id="planner-arrowhead"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 Z" className="planner-arrowhead" />
        </marker>
      </defs>
      {paths}
      {children}
    </svg>
  )
}

/** The rubber-band line drawn while dragging a new dependency out of a bar. */
export function LinkPreview({
  fromId,
  rowIndex,
  tops,
  spanFor,
  domain,
  zoom,
  pointer,
  containerRect
}: {
  fromId: string
  rowIndex: ReadonlyMap<string, number>
  tops: readonly number[]
  spanFor: (id: string) => Span
  domain: Domain
  zoom: Zoom
  pointer: { x: number; y: number }
  containerRect: DOMRect | null
}): React.JSX.Element | null {
  const row = rowIndex.get(fromId)
  if (row === undefined || !containerRect) return null
  const span = spanFor(fromId)
  const x1 =
    dateToX(domain, span.start, zoom) +
    Math.max(PX_PER_DAY[zoom], (diffDays(span.start, span.end) + 1) * PX_PER_DAY[zoom])
  const y1 = rowCenter(tops, row)
  return (
    <line
      className="planner-link-preview"
      x1={x1}
      y1={y1}
      x2={pointer.x - containerRect.left}
      y2={pointer.y - containerRect.top}
    />
  )
}
