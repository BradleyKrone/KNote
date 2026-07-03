import { useState } from 'react'
import { CalendarDays, Flag, Tag } from 'lucide-react'
import { DUE_RE } from '@shared/parser/patterns'
import { Popover } from '@/components/popover/Popover'
import { TagPickerContent } from '@/components/popover/TagPickerContent'
import { PriorityPickerContent } from '@/components/popover/PriorityPickerContent'
import { DatePickerContent } from '@/components/popover/DatePickerContent'
import { insertTag, setDueDate, setPriority } from '@/taskMeta'

type PickerKind = 'tag' | 'priority' | 'date' | null

/** While a picker popover is open, its blur (which steals focus from the field) must not submit an in-progress edit. */
export function blurTargetIsPicker(e: React.FocusEvent): boolean {
  return !!(e.relatedTarget as HTMLElement | null)?.closest('.popover-panel, .task-meta-toolbar')
}

interface Props {
  value: string
  onChange: (next: string) => void
  /** Textarea to refocus once a picker closes, so blur-to-submit keeps working. */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

/** Icon buttons that open tag/priority/due-date pickers for a plain task-text field. */
export function TaskMetaToolbar({ value, onChange, textareaRef }: Props): React.JSX.Element {
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
    textareaRef.current?.focus()
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
    </div>
  )
}
