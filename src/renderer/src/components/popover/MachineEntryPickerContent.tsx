import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { MachineConfigChips } from '@/components/MachineConfigChips'
import { useIndexStore } from '@/stores/indexStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { buildRegistry, configCodes, machineSerials } from '@/machineLog/machineLogSelectors'

interface Props {
  /** Called with the chosen serial, date (YYYY-MM-DD), and the matched machine's registered
   *  tags (model + attributes, '' if unregistered) when the user confirms. */
  onSubmit: (serial: string, date: string, tags: string[]) => void
}

/**
 * Popover for logging machine work: pick/enter a serial (with a datalist of
 * machines already known to the vault) and a date, then insert the 🚜 entry.
 */
export function MachineEntryPickerContent({ onSubmit }: Props): React.JSX.Element {
  const notes = useIndexStore((s) => s.notes)
  const machines = useSettingsStore((s) => s.vaultConfig.machines)
  const serials = useMemo(() => machineSerials(notes, machines), [notes, machines])
  const registry = useMemo(() => buildRegistry(machines), [machines])
  const [serial, setSerial] = useState('')
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'))
  const matchedDef = serial.trim() ? registry.get(serial.trim()) : undefined

  const quick: Array<{ label: string; date: string }> = [
    { label: 'Today', date: dayjs().format('YYYY-MM-DD') },
    { label: 'Yesterday', date: dayjs().subtract(1, 'day').format('YYYY-MM-DD') },
    { label: 'This Monday', date: dayjs().day(1).format('YYYY-MM-DD') }
  ]

  const submit = (): void => {
    const s = serial.trim()
    if (s) onSubmit(s, date, configCodes(registry.get(s)))
  }

  return (
    <div className="picker machine-entry-picker">
      <div className="picker-field">
        <label className="picker-field-label">Serial number</label>
        <input
          className="panel-input small"
          list="machine-serials"
          placeholder="e.g. Z6A00101"
          value={serial}
          autoFocus
          onChange={(e) => setSerial(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <datalist id="machine-serials">
          {serials.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {serial.trim() && (
          <div className="machine-picker-config" title="Confirm this is the right machine">
            <MachineConfigChips def={matchedDef} />
          </div>
        )}
      </div>
      <div className="picker-field">
        <label className="picker-field-label">Date</label>
        <div className="picker-quick-row">
          {quick.map(({ label, date: d }) => (
            <button
              key={label}
              className={`picker-quick${d === date ? ' active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setDate(d)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="date"
          className="picker-date-input"
          value={date}
          onChange={(e) => {
            if (e.target.value) setDate(e.target.value)
          }}
        />
      </div>
      <button className="btn-primary picker-submit" disabled={!serial.trim()} onClick={submit}>
        Log work
      </button>
    </div>
  )
}
