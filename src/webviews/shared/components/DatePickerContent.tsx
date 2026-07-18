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

  return (
    <div className="picker">
      <div className="picker-list">
        {quick.map(({ label, date }) => (
          <div
            key={label}
            className="picker-row"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(date)}
          >
            <span className="picker-row-label">{label}</span>
            <span className="picker-row-detail">{date}</span>
          </div>
        ))}
      </div>
      <div className="picker-date-custom">
        <input
          type="date"
          className="picker-date-input"
          defaultValue={currentDate ?? ''}
          onChange={(e) => {
            if (e.target.value) onSelect(e.target.value)
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
