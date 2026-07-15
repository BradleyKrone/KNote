// The machine work-log view: 🚜 entries collected from every note, grouped
// per machine with date/tag filtering. Right-click an entry to edit its
// machine/date.

import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Truck, Wrench } from 'lucide-react'
import { host } from '../shared/rpc'
import { useConfigStore, useIndexStore } from '../shared/stores'
import { Popover } from '../shared/components/Popover'
import { MachineConfigChips } from './MachineConfigChips'
import { MachineEntryPickerContent } from './MachineEntryPickerContent'
import {
  buildRegistry,
  collectMachineEntries,
  groupBySerial,
  machineFilterTags,
  machineSerials,
  type MachineEntry
} from './machineLogSelectors'
import { setMachineEntryFields } from './machineLogActions'

export function MachineLogApp(): React.JSX.Element {
  const notes = useIndexStore((s) => s.notes)
  const machines = useConfigStore((s) => s.vaultConfig.machines)
  const [serialFilter, setSerialFilter] = useState<string | null>(null)
  const [tagFilters, setTagFilters] = useState<string[]>([])
  const [textFilter, setTextFilter] = useState('')
  const [separate, setSeparate] = useState(false)
  const [dateEditor, setDateEditor] = useState<{
    entry: MachineEntry
    point: { x: number; y: number }
  } | null>(null)

  const serials = useMemo(() => machineSerials(notes, machines), [notes, machines])
  const tags = useMemo(() => machineFilterTags(notes, machines), [notes, machines])
  const registry = useMemo(() => buildRegistry(machines), [machines])

  const toggleTagFilter = (t: string): void => {
    setTagFilters((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
  }

  const entries = useMemo(
    () =>
      collectMachineEntries(notes, machines, {
        serial: serialFilter,
        tags: tagFilters,
        text: textFilter
      }),
    [notes, machines, serialFilter, tagFilters, textFilter]
  )
  const groups = useMemo(
    () => (separate ? groupBySerial(entries, registry) : []),
    [separate, entries, registry]
  )

  const open = (entry: MachineEntry): void => {
    void host.openNote(entry.path, entry.line)
  }

  const renderRow = (entry: MachineEntry, i: number, showSerial: boolean): React.JSX.Element => (
    <div
      key={`${entry.path}-${entry.line}-${i}`}
      className="timeline-item machine-item"
      title="Right-click to edit machine/date"
      onClick={() => open(entry)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDateEditor({ entry, point: { x: e.clientX, y: e.clientY } })
      }}
    >
      <span className="timeline-item-icon">
        <Wrench size={14} />
      </span>
      <span className="machine-item-date">{dayjs(entry.date).format('MMM D YYYY')}</span>
      {showSerial && <span className="machine-serial-badge">{entry.serial}</span>}
      <span className="timeline-item-text">{entry.text}</span>
      <span className="machine-item-note">{entry.noteTitle}</span>
      {entry.tags.map((t) => (
        <span key={t} className="board-card-tag">
          #{t}
        </span>
      ))}
    </div>
  )

  return (
    <div className="timeline-view machine-log-view">
      <div className="board-header">
        <div className="board-title">
          Machine Log
          <span className="board-scope">{entries.length} entries</span>
        </div>
        <div className="board-controls">
          <input
            className="panel-input small board-filter"
            placeholder="Filter log…"
            value={textFilter}
            onChange={(e) => setTextFilter(e.target.value)}
          />
          <select
            className="board-tag-select"
            value={serialFilter ?? ''}
            onChange={(e) => setSerialFilter(e.target.value || null)}
          >
            <option value="">All machines</option>
            {serials.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <label className="machine-separate-toggle" title="Show a separate timeline per machine">
            <input
              type="checkbox"
              checked={separate}
              onChange={(e) => setSeparate(e.target.checked)}
            />
            Separate timelines
          </label>
        </div>
      </div>
      {tags.length > 0 && (
        <div className="machine-tag-filters">
          {tags.map((t) => (
            <button
              key={t}
              className={`picker-quick${tagFilters.includes(t) ? ' active' : ''}`}
              title={`Filter to entries tagged #${t}`}
              onClick={() => toggleTagFilter(t)}
            >
              {t}
            </button>
          ))}
          {tagFilters.length > 0 && (
            <button
              className="machine-tag-clear"
              title="Clear tag filters"
              onClick={() => setTagFilters([])}
            >
              Clear
            </button>
          )}
        </div>
      )}
      <div className="timeline-scroll">
        <div className="timeline-track">
          {entries.length === 0 && (
            <div className="panel-empty timeline-empty">
              No machine work logged yet. Run <strong>KNote: Insert Machine Log Entry</strong> in a
              note to add a <code>🚜 &lt;serial&gt; what you did 📅 date</code> entry. Register each
              machine once in KNote Settings → Machines so its configuration shows and becomes
              filterable.
            </div>
          )}
          {!separate && entries.map((entry, i) => renderRow(entry, i, true))}
          {separate &&
            groups.map((group) => (
              <div key={group.serial} className="machine-group">
                <div className="machine-group-header">
                  <Truck size={16} />
                  <span className="machine-serial-badge lg">{group.serial}</span>
                  <MachineConfigChips def={group.def} />
                  <span className="machine-group-count">{group.entries.length}</span>
                </div>
                <div className="timeline-items">
                  {group.entries.map((entry, i) => renderRow(entry, i, false))}
                </div>
              </div>
            ))}
        </div>
      </div>
      {dateEditor && (
        <Popover anchorPoint={dateEditor.point} onClose={() => setDateEditor(null)}>
          <MachineEntryPickerContent
            initialSerial={dateEditor.entry.serial}
            initialDate={dateEditor.entry.date}
            submitLabel="Save"
            onSubmit={(serial, date) => {
              void setMachineEntryFields(dateEditor.entry, serial, date)
              setDateEditor(null)
            }}
          />
        </Popover>
      )}
    </div>
  )
}
