import { useState } from 'react'

interface Props {
  /** Called with the data-row count and column count when the user confirms. */
  onSubmit: (rows: number, cols: number) => void
}

const PRESETS = [
  { label: '2 x 2', rows: 2, cols: 2 },
  { label: '3 x 3', rows: 3, cols: 3 },
  { label: '4 x 4', rows: 4, cols: 4 }
]

/** Popover for picking a new table's data-row and column count. */
export function TablePickerContent({ onSubmit }: Props): React.JSX.Element {
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)

  const valid = rows >= 1 && cols >= 1
  const submit = (): void => {
    if (valid) onSubmit(rows, cols)
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') submit()
  }

  return (
    <div className="picker table-picker">
      <div className="picker-quick-row">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            className={`picker-quick${p.rows === rows && p.cols === cols ? ' active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setRows(p.rows)
              setCols(p.cols)
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="picker-field">
        <label className="picker-field-label">Rows</label>
        <input
          type="number"
          className="panel-input small"
          min={1}
          value={rows}
          autoFocus
          onChange={(e) => setRows(Number(e.target.value))}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="picker-field">
        <label className="picker-field-label">Columns</label>
        <input
          type="number"
          className="panel-input small"
          min={1}
          value={cols}
          onChange={(e) => setCols(Number(e.target.value))}
          onKeyDown={onKeyDown}
        />
      </div>
      <button className="btn-primary picker-submit" disabled={!valid} onClick={submit}>
        Insert table
      </button>
    </div>
  )
}
