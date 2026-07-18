import { PRIORITY_LABELS } from '../taskMeta'

interface Props {
  onSelect: (level: 0 | 1 | 2 | 3) => void
}

const LEVELS: Array<{ level: 0 | 1 | 2 | 3; label: string; marker: string }> = [
  { level: 0, label: 'None', marker: '' },
  { level: 1, label: PRIORITY_LABELS[1], marker: '!' },
  { level: 2, label: PRIORITY_LABELS[2], marker: '!!' },
  { level: 3, label: PRIORITY_LABELS[3], marker: '!!!' }
]

export function PriorityPickerContent({ onSelect }: Props): React.JSX.Element {
  return (
    <div className="picker">
      <div className="picker-list">
        {LEVELS.map(({ level, label, marker }) => (
          <div
            key={level}
            className="picker-row"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(level)}
          >
            <span className={`picker-row-label${level > 0 ? ` prio-${level}` : ''}`}>{label}</span>
            <span className="picker-row-detail">{marker}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
