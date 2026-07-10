import { useEffect, useRef, useState } from 'react'

// The shared scaffold behind the command palette, quick switcher, and
// template picker: centered modal with an optional filter input, a results
// list, and Arrow/Enter/Escape keyboard navigation. Mount it only while
// open — selection and focus reset on mount.

export interface ListModalRow {
  key: string
  label: string
  detail?: string
}

interface Props {
  rows: ListModalRow[]
  onPick: (index: number) => void
  onClose: () => void
  /** Editable filter input shown at the top. */
  input?: { placeholder: string; value: string; onChange: (value: string) => void }
  /** Static header text used instead of an input (e.g. template picker). */
  header?: string
}

export function ListModal({ rows, onPick, onClose, input, header }: Props): React.JSX.Element {
  const [selected, setSelected] = useState(0)
  const focusRef = useRef<HTMLInputElement & HTMLDivElement>(null)

  useEffect(() => {
    setTimeout(() => focusRef.current?.focus(), 0)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' && rows[selected]) {
      e.preventDefault()
      onPick(selected)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        ref={input ? undefined : focusRef}
        tabIndex={input ? undefined : -1}
        className="modal-panel"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={input ? undefined : onKeyDown}
      >
        {input ? (
          <input
            ref={focusRef}
            className="modal-input"
            placeholder={input.placeholder}
            value={input.value}
            onChange={(e) => {
              input.onChange(e.target.value)
              setSelected(0)
            }}
            onKeyDown={onKeyDown}
          />
        ) : (
          <div className="modal-input" style={{ cursor: 'default' }}>
            {header}
          </div>
        )}
        <div className="modal-results">
          {rows.map((row, i) => (
            <div
              key={row.key}
              className={`modal-result${i === selected ? ' selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => onPick(i)}
            >
              <span className="modal-result-label">{row.label}</span>
              {row.detail !== undefined && <span className="modal-result-detail">{row.detail}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
