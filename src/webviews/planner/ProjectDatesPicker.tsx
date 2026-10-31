// The calendar editor behind a project's right-click → "Set project dates…".
//
// Both sides are optional — a project may declare a start, an end, both or
// neither — and are committed together in one frontmatter rewrite, so the
// planner never sees a half-applied window.

import { useState } from 'react'
import dayjs from 'dayjs'
import { planProjectDates } from './plannerActions'
import type { PlannerProject } from './plannerSelectors'

interface Props {
  project: PlannerProject
  /** `start`/`end` set or (null) clear that side — never undefined: both are always written. */
  onApply: (start: string | null, end: string | null) => void
}

export function ProjectDatesPicker({ project, onApply }: Props): React.JSX.Element {
  const [start, setStart] = useState(project.startDate ?? '')
  const [end, setEnd] = useState(project.dueDate ?? '')

  const invalid = !!start && !!end && start > end
  const dirty = start !== (project.startDate ?? '') || end !== (project.dueDate ?? '')
  const canApply = dirty && !invalid
  const apply = (): void => {
    if (canApply) onApply(start || null, end || null)
  }
  // A side brought inward fits everything inside it (`planShrink`): say so
  // up front, and whether anything will have to be shortened — Apply then
  // asks before trimming.
  const fit = invalid
    ? null
    : planProjectDates(project, { start: start || null, end: end || null }).reflow
  const moved = fit ? fit.spans.length + fit.points.length : 0
  const trimmed = fit ? fit.spans.filter((s) => s.trimmed).length : 0

  const row = (label: string, value: string, set: (v: string) => void): React.JSX.Element => (
    <label className="span-picker-row">
      <span className="span-picker-label">{label}</span>
      <input
        type="date"
        className="picker-date-input"
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            apply()
          }
        }}
      />
      <button
        className="picker-quick"
        title={`Clear the project's ${label.toLowerCase()} date`}
        disabled={!value}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault()
          set('')
        }}
      >
        ×
      </button>
    </label>
  )

  return (
    <div className="picker span-picker">
      <div className="picker-field">
        {row('Start', start, setStart)}
        {row('End', end, setEnd)}
        <div className="span-picker-summary">
          {invalid ? (
            <span className="span-picker-warn">The end date is before the start date.</span>
          ) : (
            <>
              {start ? dayjs(start).format('ddd, MMM D YYYY') : 'No start'} →{' '}
              {end ? dayjs(end).format('ddd, MMM D YYYY') : 'no end'}
              {project.start && project.end && (
                <div className="span-picker-hint">
                  Deliverables run {project.start} → {project.end}
                  {moved > 0 &&
                    ` — ${moved} item${moved === 1 ? '' : 's'} will slide in to fit${
                      trimmed > 0 ? `, ${trimmed} shortened` : ''
                    }`}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <div
        className={`picker-row picker-apply${canApply ? '' : ' disabled'}`}
        aria-disabled={!canApply}
        onMouseDown={(e) => e.preventDefault()}
        onClick={canApply ? apply : undefined}
      >
        Apply dates
      </div>
    </div>
  )
}
