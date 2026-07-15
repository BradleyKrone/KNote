// Inline "Any / Today / This week / Date… / Range…" dropdown used by the
// board's Status Changed / Date Entered / Due Date filters.

import type { DateRangeFilter } from './boardSelectors'

interface Props {
  label: string
  value: DateRangeFilter
  onChange: (value: DateRangeFilter) => void
}

export function DateRangeFilterControl({ label, value, onChange }: Props): React.JSX.Element {
  return (
    <div className="board-date-filter">
      <select
        className="board-tag-select"
        value={value.kind}
        onChange={(e) => {
          switch (e.target.value) {
            case 'date':
              onChange({ kind: 'date', date: 'date' in value ? value.date : '' })
              break
            case 'range':
              onChange({
                kind: 'range',
                from: 'from' in value ? value.from : '',
                to: 'to' in value ? value.to : ''
              })
              break
            default:
              onChange({ kind: e.target.value as 'any' | 'today' | 'week' })
          }
        }}
      >
        <option value="any">{label}: Any</option>
        <option value="today">{label}: Today</option>
        <option value="week">{label}: This week</option>
        <option value="date">{label}: Date…</option>
        <option value="range">{label}: Range…</option>
      </select>
      {value.kind === 'date' && (
        <input
          type="date"
          className="board-date-input"
          value={value.date}
          onChange={(e) => onChange({ kind: 'date', date: e.target.value })}
        />
      )}
      {value.kind === 'range' && (
        <>
          <input
            type="date"
            className="board-date-input"
            value={value.from}
            onChange={(e) => onChange({ kind: 'range', from: e.target.value, to: value.to })}
          />
          <span className="board-date-filter-sep">–</span>
          <input
            type="date"
            className="board-date-input"
            value={value.to}
            onChange={(e) => onChange({ kind: 'range', from: value.from, to: e.target.value })}
          />
        </>
      )}
    </div>
  )
}
