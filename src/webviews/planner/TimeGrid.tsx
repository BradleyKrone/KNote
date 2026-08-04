// The chart's time ruler and backdrop: month + day/week header bands, the
// vertical gridlines, and the today line.
//
// Gridlines are a repeating CSS gradient rather than one element per day —
// at day zoom a year-wide domain would otherwise be hundreds of divs that
// exist only to draw a 1px line.

import {
  dateToCenterX,
  gridWidth,
  PX_PER_DAY,
  type Band,
  type Domain,
  type Zoom
} from './plannerLayout'

interface HeaderProps {
  domain: Domain
  zoom: Zoom
  months: readonly Band[]
  subs: readonly Band[]
  today: string
  width: number
}

export function GridHeader({
  domain,
  zoom,
  months,
  subs,
  today,
  width
}: HeaderProps): React.JSX.Element {
  return (
    <div className="planner-header" style={{ width }}>
      <div className="planner-header-band months">
        {months.map((band) => (
          <div key={band.key} className="planner-band" style={{ left: band.x, width: band.width }}>
            {band.label}
          </div>
        ))}
      </div>
      <div className="planner-header-band subs">
        {subs.map((band) => (
          <div
            key={band.key}
            className={`planner-band sub${band.muted ? ' muted' : ''}`}
            style={{ left: band.x, width: band.width }}
          >
            {band.label}
          </div>
        ))}
      </div>
      <div className="planner-today-pip" style={{ left: dateToCenterX(domain, today, zoom) }} />
    </div>
  )
}

interface BodyProps {
  domain: Domain
  zoom: Zoom
  today: string
  /** Total height of the row stack, including the gaps between projects. */
  height: number
  children: React.ReactNode
}

export function GridBody({ domain, zoom, today, height, children }: BodyProps): React.JSX.Element {
  const px = PX_PER_DAY[zoom]
  // One gridline per week at day zoom (a line every 30px is legible), per month
  // elsewhere (~a line every 30-110px).
  const step = zoom === 'day' ? px * 7 : px * 30
  return (
    <div
      className="planner-grid-body"
      style={{
        width: gridWidth(domain, zoom),
        height,
        // Vertical banding is off: rows no longer sit on a fixed pitch once the
        // gaps between projects are in, so a repeating stripe would drift out
        // of step with them.
        backgroundSize: `${step}px 100%`
      }}
    >
      <div className="planner-today-line" style={{ left: dateToCenterX(domain, today, zoom) }} />
      {children}
    </div>
  )
}
