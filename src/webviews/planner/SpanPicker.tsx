// The calendar editor behind a deliverable's right-click → "Edit dates…".
//
// Both halves of the span are edited together and committed in one verified
// line rewrite, so a date change from here is exactly the same edit a drag
// makes — never two writes racing each other's index delta.

import { useState } from 'react'
import dayjs from 'dayjs'
import { addDays, diffDays, today } from './plannerLayout'
import type { PlannerDeliverable } from './plannerSelectors'

interface Props {
  deliverable: PlannerDeliverable
  onApply: (start: string, end: string) => void
}

export function SpanPicker({ deliverable, onApply }: Props): React.JSX.Element {
  const [start, setStart] = useState(deliverable.start)
  const [end, setEnd] = useState(deliverable.end)

  const length = diffDays(start, end) + 1
  const invalid = start > end
  const dirty = start !== deliverable.start || end !== deliverable.end

  /** Slide the whole span, keeping its length — the keyboard equivalent of dragging the bar. */
  const shift = (days: number): void => {
    setStart(addDays(start, days))
    setEnd(addDays(end, days))
  }

  /** Move the end so the span becomes `days` long, keeping the start put. */
  const setLength = (days: number): void => setEnd(addDays(start, days - 1))

  return (
    <div className="picker span-picker">
      <div className="picker-field">
        <label className="span-picker-row">
          <span className="span-picker-label">Start</span>
          <input
            type="date"
            className="picker-date-input"
            value={start}
            onChange={(e) => e.target.value && setStart(e.target.value)}
          />
        </label>
        <label className="span-picker-row">
          <span className="span-picker-label">End</span>
          <input
            type="date"
            className="picker-date-input"
            value={end}
            onChange={(e) => e.target.value && setEnd(e.target.value)}
          />
        </label>

        <div className="picker-quick-row">
          {[1, 3, 5, 10, 20].map((days) => (
            <button
              key={days}
              className={`picker-quick${length === days ? ' active' : ''}`}
              title={`Make this deliverable ${days} day${days === 1 ? '' : 's'} long`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setLength(days)}
            >
              {days}d
            </button>
          ))}
        </div>
        <div className="picker-quick-row">
          {[
            { label: '−1w', days: -7 },
            { label: '−1d', days: -1 },
            { label: '+1d', days: 1 },
            { label: '+1w', days: 7 }
          ].map(({ label, days }) => (
            <button
              key={label}
              className="picker-quick"
              title="Slide the whole span, keeping its length"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => shift(days)}
            >
              {label}
            </button>
          ))}
          <button
            className="picker-quick"
            title="Start today, keeping its length"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => shift(diffDays(start, today()))}
          >
            Today
          </button>
        </div>

        <div className="span-picker-summary">
          {invalid ? (
            <span className="span-picker-warn">The end date is before the start date.</span>
          ) : (
            <>
              {dayjs(start).format('ddd, MMM D')} → {dayjs(end).format('ddd, MMM D YYYY')} ·{' '}
              {length} day{length === 1 ? '' : 's'}
            </>
          )}
        </div>
      </div>
      <div
        className={`picker-row picker-apply${invalid || !dirty ? ' disabled' : ''}`}
        aria-disabled={invalid || !dirty}
        onMouseDown={(e) => e.preventDefault()}
        onClick={invalid || !dirty ? undefined : () => onApply(start, end)}
      >
        Apply dates
      </div>
    </div>
  )
}
