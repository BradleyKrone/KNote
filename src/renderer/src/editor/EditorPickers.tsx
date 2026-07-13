// The tag/priority/due-date/machine-entry popover opened from the editor's
// context menu. EditorPane owns which picker is active; this renders the
// matching picker content and applies the choice at the cursor.

import { EditorView } from '@codemirror/view'
import { DUE_RE, MACHINE_ENTRY_RE } from '@shared/parser/patterns'
import { Popover } from '@/components/popover/Popover'
import { TagPickerContent } from '@/components/popover/TagPickerContent'
import { PriorityPickerContent } from '@/components/popover/PriorityPickerContent'
import { DatePickerContent } from '@/components/popover/DatePickerContent'
import { MachineEntryPickerContent } from '@/components/popover/MachineEntryPickerContent'
import type { PickerKind } from './contextMenu'
import {
  editMachineEntryAtCursor,
  insertMachineEntryAtCursor,
  insertTagAtCursor,
  setDueDateAtCursor,
  setPriorityAtCursor
} from './formatting'

export interface ActivePicker {
  kind: PickerKind
  x: number
  y: number
}

interface Props {
  picker: ActivePicker
  /** Getter, not a snapshot — the view can be rebuilt while the popover is open. */
  getView: () => EditorView | null
  onClose: () => void
}

function currentLineDue(view: EditorView | null): string | null {
  if (!view) return null
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const m = DUE_RE.exec(line.text)
  return m ? (m[1] ?? m[2]) : null
}

function currentLineMachine(view: EditorView | null): { serial: string; date: string } | null {
  if (!view) return null
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const m = MACHINE_ENTRY_RE.exec(line.text)
  if (!m) return null
  const due = DUE_RE.exec(m[2])
  return { serial: m[1], date: due ? (due[1] ?? due[2]) : '' }
}

export function EditorPickers({ picker, getView, onClose }: Props): React.JSX.Element {
  const withView = (apply: (view: EditorView) => void): void => {
    const view = getView()
    if (view) apply(view)
    onClose()
  }

  return (
    <Popover anchorPoint={{ x: picker.x, y: picker.y }} onClose={onClose}>
      {picker.kind === 'tag' && (
        <TagPickerContent onSelect={(tag) => withView((view) => insertTagAtCursor(view, tag))} />
      )}
      {picker.kind === 'priority' && (
        <PriorityPickerContent
          onSelect={(level) => withView((view) => setPriorityAtCursor(view, level))}
        />
      )}
      {picker.kind === 'date' && (
        <DatePickerContent
          currentDate={currentLineDue(getView())}
          onSelect={(date) => withView((view) => setDueDateAtCursor(view, date))}
        />
      )}
      {picker.kind === 'machine' && (
        <MachineEntryPickerContent
          onSubmit={(serial, date, tags) =>
            withView((view) => insertMachineEntryAtCursor(view, serial, date, tags))
          }
        />
      )}
      {picker.kind === 'edit-machine' &&
        (() => {
          const current = currentLineMachine(getView())
          return (
            <MachineEntryPickerContent
              initialSerial={current?.serial}
              initialDate={current?.date || undefined}
              submitLabel="Save"
              onSubmit={(serial, date) =>
                withView((view) => editMachineEntryAtCursor(view, serial, date))
              }
            />
          )
        })()}
    </Popover>
  )
}
