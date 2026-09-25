import { Fragment, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
  SECTION_LABELS,
  SOFTWARE_KINDS,
  SOFTWARE_SECTIONS,
  emptySoftware,
  type MachineSoftware,
  type SoftwareKind,
  type SoftwareSection
} from '@shared/machineSoftware'
import { useConfigStore, useIndexStore } from '../shared/stores'
import { MachineConfigChips } from './MachineConfigChips'
import {
  buildRegistry,
  configCodes,
  knownSoftwareVersions,
  machineSerials
} from './machineLogSelectors'

interface Props {
  /** Called with the chosen serial, date (YYYY-MM-DD), the matched machine's registered
   *  tags (model + attributes, [] if unregistered), and both software sections when the
   *  user confirms. */
  onSubmit: (serial: string, date: string, tags: string[], software: MachineSoftware) => void
  /** Pre-fill for editing an existing entry instead of logging a new one. */
  initialSerial?: string
  initialDate?: string
  initialSoftware?: MachineSoftware
  /** Submit button label — defaults to "Log work". */
  submitLabel?: string
}

/** Popover for logging/editing a machine entry: serial, date, and the software on / flashed to it. */
export function MachineEntryPickerContent({
  onSubmit,
  initialSerial = '',
  initialDate,
  initialSoftware,
  submitLabel = 'Log work'
}: Props): React.JSX.Element {
  const notes = useIndexStore((s) => s.notes)
  const machines = useConfigStore((s) => s.vaultConfig.machines)
  const serials = useMemo(() => machineSerials(notes, machines), [notes, machines])
  const registry = useMemo(() => buildRegistry(machines), [machines])
  const versions = useMemo(() => knownSoftwareVersions(notes), [notes])
  const [serial, setSerial] = useState(initialSerial)
  const [date, setDate] = useState(initialDate ?? dayjs().format('YYYY-MM-DD'))
  const [software, setSoftware] = useState<MachineSoftware>(initialSoftware ?? emptySoftware)
  const matchedDef = serial.trim() ? registry.get(serial.trim()) : undefined

  const quick: Array<{ label: string; date: string }> = [
    { label: 'Today', date: dayjs().format('YYYY-MM-DD') },
    { label: 'Yesterday', date: dayjs().subtract(1, 'day').format('YYYY-MM-DD') },
    { label: 'This Monday', date: dayjs().day(1).format('YYYY-MM-DD') }
  ]

  const submit = (): void => {
    const s = serial.trim()
    if (s) onSubmit(s, date, configCodes(registry.get(s)), software)
  }

  const submitOnEnter = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') submit()
  }

  const setVersion = (section: SoftwareSection, kind: SoftwareKind, value: string): void => {
    setSoftware((prev) => ({ ...prev, [section]: { ...prev[section], [kind]: value } }))
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
          onKeyDown={submitOnEnter}
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
      {/* One suggestion list per kind, shared by both sections — yesterday's
          flashed version is today's base version. */}
      {SOFTWARE_KINDS.map((kind) => (
        <datalist key={kind} id={`machine-sw-${kind}`}>
          {versions[kind].map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      ))}
      <div className="picker-field">
        <label className="picker-field-label">Software</label>
        <div className="machine-sw-table">
          <span />
          <span className="machine-sw-col">{SECTION_LABELS.base}</span>
          <span />
          <span className="machine-sw-col">{SECTION_LABELS.flashed}</span>
          {SOFTWARE_KINDS.map((kind) => (
            <Fragment key={kind}>
              <span className="machine-sw-kind">{kind}</span>
              {SOFTWARE_SECTIONS.map((section, i) => (
                <Fragment key={section}>
                  {i > 0 && <span className="machine-sw-arrow">→</span>}
                  <input
                    className="panel-input small"
                    list={`machine-sw-${kind}`}
                    aria-label={`${kind} ${SECTION_LABELS[section]}`}
                    value={software[section][kind]}
                    onChange={(e) => setVersion(section, kind, e.target.value)}
                    onKeyDown={submitOnEnter}
                  />
                </Fragment>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
      <button className="btn-primary picker-submit" disabled={!serial.trim()} onClick={submit}>
        {submitLabel}
      </button>
    </div>
  )
}
