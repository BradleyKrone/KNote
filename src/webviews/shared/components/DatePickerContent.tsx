import { useState } from 'react'
import dayjs from 'dayjs'

interface Props {
  currentDate: string | null
  onSelect: (date: string | null) => void
}

export function DatePickerContent({ currentDate, onSelect }: Props): React.JSX.Element {
  const quick: Array<{ label: string; date: string }> = [
    { label: 'Today', date: dayjs().format('YYYY-MM-DD') },
    { label: 'Tomorrow', date: dayjs().add(1, 'day').format('YYYY-MM-DD') },
    { label: 'Next Monday', date: dayjs().day(8).format('YYYY-MM-DD') },
    { label: 'In a week', date: dayjs().add(1, 'week').format('YYYY-MM-DD') }
  ]

  // Draft is local so browsing the native calendar (which fires a real "change" on every
  // month/day it lands on, not just on a final pick) doesn't apply-and-close the popover
  // on the first click of the next-month arrow. Only a blur (user done with the field)
  // or a quick-pick button commits.
  const [draft, setDraft] = useState(currentDate ?? '')

  return (
    <div className="picker">
      <div className="picker-field">
        <div className="picker-quick-row">
          {quick.map(({ label, date }) => (
            <button
              key={label}
              className={`picker-quick${date === draft ? ' active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(date)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="date"
          className="picker-date-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft && draft !== currentDate) onSelect(draft)
          }}
        />
      </div>
      {currentDate && (
        <div
          className="picker-row picker-clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(null)}
        >
          Clear due date
        </div>
      )}
    </div>
  )
}
