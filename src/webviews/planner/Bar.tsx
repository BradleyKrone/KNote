// One deliverable's bar on the chart: its span, its % complete fill, its
// resize grips and the link grip that starts a dependency drag.

import { Link2 } from 'lucide-react'
import {
  dateToCenterX,
  dateToX,
  diffDays,
  PX_PER_DAY,
  ROW_HEIGHT,
  type Domain,
  type Zoom
} from './plannerLayout'
import type { PlannerDeliverable, PlannerMilestone } from './plannerSelectors'
import type { DragMode } from './useBarDrag'

const BAR_HEIGHT = 18

interface Props {
  deliverable: PlannerDeliverable
  /** Span to draw — the model's, or the in-flight preview during a drag. */
  start: string
  end: string
  domain: Domain
  zoom: Zoom
  colorIndex: number
  violated: boolean
  dragging: boolean
  linkTarget: boolean
  onGrip: (e: React.PointerEvent, mode: DragMode) => void
  onOpen: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

export function Bar({
  deliverable,
  start,
  end,
  domain,
  zoom,
  colorIndex,
  violated,
  dragging,
  linkTarget,
  onGrip,
  onOpen,
  onContextMenu
}: Props): React.JSX.Element {
  const x = dateToX(domain, start, zoom)
  // Inclusive of the end day, so a one-day deliverable is still a visible bar.
  const width = Math.max(PX_PER_DAY[zoom], (diffDays(start, end) + 1) * PX_PER_DAY[zoom])
  const className = [
    'planner-bar',
    `planner-color-${colorIndex % 6}`,
    dragging ? 'dragging' : '',
    violated ? 'violated' : '',
    linkTarget ? 'link-target' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      data-deliverable={deliverable.id}
      style={{ left: x, width, height: BAR_HEIGHT, top: (ROW_HEIGHT - BAR_HEIGHT) / 2 }}
      title={`${deliverable.label} · ${start} → ${end} · ${deliverable.percent}%${
        violated ? ' · starts before a deliverable it depends on finishes' : ''
      }`}
      onPointerDown={(e) => onGrip(e, 'move')}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
    >
      <div className="planner-bar-fill" style={{ width: `${deliverable.percent}%` }} />
      <span
        className="planner-grip start"
        title="Drag to change the start date"
        onPointerDown={(e) => onGrip(e, 'resize-start')}
      />
      <span
        className="planner-grip end"
        title="Drag to change the end date"
        onPointerDown={(e) => onGrip(e, 'resize-end')}
      />
      <span
        className="planner-link-grip"
        title="Drag onto another deliverable to make it wait on this one"
        onPointerDown={(e) => onGrip(e, 'link')}
      >
        <Link2 size={10} />
      </span>
      <span className="planner-bar-label">
        {deliverable.label} <span className="planner-bar-percent">{deliverable.percent}%</span>
      </span>
    </div>
  )
}

/** A 🏁 milestone: a diamond pinned to its date. */
export function MilestoneMark({
  milestone,
  domain,
  zoom,
  onOpen
}: {
  milestone: PlannerMilestone
  domain: Domain
  zoom: Zoom
  onOpen: () => void
}): React.JSX.Element {
  const size = milestone.important ? 16 : 11
  return (
    <div
      className={`planner-milestone${milestone.important ? ' important' : ''}`}
      style={{ left: dateToCenterX(domain, milestone.date, zoom), top: (ROW_HEIGHT - size) / 2 }}
      title={`${milestone.text} · ${milestone.date}`}
      onDoubleClick={onOpen}
    >
      <span className="planner-diamond" style={{ width: size, height: size }} />
      <span className="planner-milestone-label">{milestone.text}</span>
    </div>
  )
}
