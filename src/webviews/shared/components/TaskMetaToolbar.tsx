import { useState } from 'react'
import { CalendarDays, Flag, Package, Tag } from 'lucide-react'
import { DUE_RE } from '@shared/parser/patterns'
import { insertDeliverableRef, insertTag, setDueDate, setPriority } from '../taskMeta'
import { Popover } from './Popover'
import { TagPickerContent } from './TagPickerContent'
import { PriorityPickerContent } from './PriorityPickerContent'
import { DatePickerContent } from './DatePickerContent'
import { DeliverablePickerContent } from './DeliverablePickerContent'

type PickerKind = 'tag' | 'priority' | 'date' | 'deliverable' | null

interface Props {
  value: string
  onChange: (next: string) => void
  /** Called once a picker closes, so refocusing the title field keeps working. */
  onDone: () => void
}

/** Icon buttons that open tag/priority/due-date pickers for a plain task-text field. */
export function TaskMetaToolbar({ value, onChange, onDone }: Props): React.JSX.Element {
  const [open, setOpen] = useState<PickerKind>(null)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  const openPicker = (kind: PickerKind, e: React.MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    setAnchorEl(e.currentTarget)
    setOpen(kind)
  }

  const close = (): void => {
    setOpen(null)
    setAnchorEl(null)
    onDone()
  }

  const currentDue = DUE_RE.exec(value)
  const dueDate = currentDue ? (currentDue[1] ?? currentDue[2]) : null

  return (
    <div className="task-meta-toolbar">
      <button
        type="button"
        className="icon-btn"
        title="Add tag"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => openPicker('tag', e)}
      >
        <Tag size={13} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Set priority"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => openPicker('priority', e)}
      >
        <Flag size={13} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Set due date"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => openPicker('date', e)}
      >
        <CalendarDays size={13} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Link to deliverable"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => openPicker('deliverable', e)}
      >
        <Package size={13} />
      </button>

      {open === 'tag' && (
        <Popover anchorEl={anchorEl} onClose={close}>
          <TagPickerContent
            onSelect={(tag) => {
              onChange(insertTag(value, tag))
              close()
            }}
          />
        </Popover>
      )}
      {open === 'priority' && (
        <Popover anchorEl={anchorEl} onClose={close}>
          <PriorityPickerContent
            onSelect={(level) => {
              onChange(setPriority(value, level))
              close()
            }}
          />
        </Popover>
      )}
      {open === 'date' && (
        <Popover anchorEl={anchorEl} onClose={close}>
          <DatePickerContent
            currentDate={dueDate}
            onSelect={(date) => {
              onChange(setDueDate(value, date))
              close()
            }}
          />
        </Popover>
      )}
      {open === 'deliverable' && (
        <Popover anchorEl={anchorEl} onClose={close}>
          <DeliverablePickerContent
            onSelect={(tag) => {
              onChange(insertDeliverableRef(value, tag))
              close()
            }}
          />
        </Popover>
      )}
    </div>
  )
}
