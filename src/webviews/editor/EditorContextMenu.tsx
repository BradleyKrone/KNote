// The live-preview editor's right-click menu. Attaches a `contextmenu` listener
// to the CodeMirror DOM, reads the line under the click to decide which items
// apply (task/milestone → tag/priority/due; 🚜 line → edit machine; a checkbox
// glyph → the Kanban status switcher), and renders the menu — plus any picker an
// item opens — inside the shared Popover. Reproduces the old Electron app's
// editor context menu (src/renderer/src/editor/contextMenu.ts).

import { useEffect, useState } from 'react'
import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { BoardColumn } from '@shared/types'
import {
  ARCHIVED_CHAR,
  MACHINE_ENTRY_RE,
  MILESTONE_LINE_RE,
  TASK_LINE_RE
} from '@shared/parser/patterns'
import { Popover } from '../shared/components/Popover'
import { ContextMenuList, type MenuEntry } from '../shared/components/ContextMenuList'
import { DatePickerContent } from '../shared/components/DatePickerContent'
import { PriorityPickerContent } from '../shared/components/PriorityPickerContent'
import { TagPickerContent } from '../shared/components/TagPickerContent'
import { MachineEntryPickerContent } from '../machineLog/MachineEntryPickerContent'
import { useConfigStore } from '../shared/stores'
import { toggleWrap } from './markdownFormatting'
import { setCheckboxStatus } from './knoteConstructs'
import {
  addLineTag,
  editMachineOnLine,
  insertCheckbox,
  insertMachineEntry,
  insertMilestone,
  insertWikiLink,
  lineDue,
  setLineDue,
  setLinePriority
} from './editorActions'

/** The line under the right-click, captured when the menu opens. */
interface LineCtx {
  line0: number
  text: string
  isTask: boolean
  isMilestone: boolean
  isMachine: boolean
  due: string | null
  serial: string
}

type Point = { x: number; y: number }
type SubKind = 'machine' | 'edit-machine' | 'date' | 'priority' | 'tag'

type OpenState =
  | { stage: 'menu'; onCheckbox: boolean; point: Point; ctx: LineCtx }
  | { stage: 'sub'; sub: SubKind; point: Point; ctx: LineCtx }
  | null

function readLineCtx(view: EditorView, pos: number): LineCtx {
  const line = view.state.doc.lineAt(pos)
  return {
    line0: line.number - 1,
    text: line.text,
    isTask: TASK_LINE_RE.test(line.text),
    isMilestone: MILESTONE_LINE_RE.test(line.text),
    isMachine: MACHINE_ENTRY_RE.test(line.text),
    due: lineDue(line.text),
    serial: MACHINE_ENTRY_RE.exec(line.text)?.[1] ?? ''
  }
}

export function EditorContextMenu({ view }: { view: EditorView }): React.JSX.Element | null {
  const [open, setOpen] = useState<OpenState>(null)
  const columns = useConfigStore((s) => s.vaultConfig.columns)

  useEffect(() => {
    const dom = view.dom
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      const point = { x: e.clientX, y: e.clientY }
      const pos = view.posAtCoords(point) ?? view.state.selection.main.head
      // Place the caret where the user clicked (unless they have a selection),
      // so inserts and line edits land on the clicked line.
      if (view.state.selection.main.empty) {
        view.dispatch({ selection: EditorSelection.cursor(pos) })
      }
      const target = e.target as HTMLElement | null
      const onCheckbox = target?.closest('.cm-knote-check') != null
      setOpen({ stage: 'menu', onCheckbox, point, ctx: readLineCtx(view, pos) })
    }
    dom.addEventListener('contextmenu', onContextMenu)
    return () => dom.removeEventListener('contextmenu', onContextMenu)
  }, [view])

  if (!open) return null
  const close = (): void => setOpen(null)
  const { point, ctx } = open

  // Run an action then close the menu.
  const run = (fn: () => void) => () => {
    close()
    fn()
  }
  const openSub = (sub: SubKind) => (): void => setOpen({ stage: 'sub', sub, point, ctx })

  if (open.stage === 'menu') {
    const items: MenuEntry[] = open.onCheckbox
      ? checkboxItems(ctx, columns, (col) => {
          close()
          void setCheckboxStatus(ctx.line0, ctx.text, col)
        })
      : mainItems(view, ctx, run, openSub)
    return (
      <Popover anchorPoint={point} onClose={close}>
        <ContextMenuList items={items} />
      </Popover>
    )
  }

  return (
    <Popover anchorPoint={point} onClose={close}>
      {open.sub === 'machine' && (
        <MachineEntryPickerContent
          onSubmit={(serial, date, tags) => {
            close()
            insertMachineEntry(view, serial, date, tags)
          }}
        />
      )}
      {open.sub === 'edit-machine' && (
        <MachineEntryPickerContent
          initialSerial={ctx.serial}
          initialDate={ctx.due ?? undefined}
          submitLabel="Save"
          onSubmit={(serial, date) => {
            close()
            editMachineOnLine(view, serial, date)
          }}
        />
      )}
      {open.sub === 'date' && (
        <DatePickerContent
          currentDate={ctx.due}
          onSelect={(date) => {
            close()
            setLineDue(view, date)
          }}
        />
      )}
      {open.sub === 'priority' && (
        <PriorityPickerContent
          onSelect={(level) => {
            close()
            setLinePriority(view, level)
          }}
        />
      )}
      {open.sub === 'tag' && (
        <TagPickerContent
          onSelect={(tag) => {
            close()
            addLineTag(view, tag)
          }}
        />
      )}
    </Popover>
  )
}

function mainItems(
  view: EditorView,
  ctx: LineCtx,
  run: (fn: () => void) => () => void,
  openSub: (sub: SubKind) => () => void
): MenuEntry[] {
  const items: MenuEntry[] = [
    { label: 'Bold', onClick: run(() => toggleWrap(view, '**')) },
    { label: 'Italic', onClick: run(() => toggleWrap(view, '*')) },
    { label: 'Strikethrough', onClick: run(() => toggleWrap(view, '~~')) },
    { label: 'Inline code', onClick: run(() => toggleWrap(view, '`')) },
    { label: 'Insert wiki link', onClick: run(() => insertWikiLink(view)) },
    { separator: true },
    { label: 'Add checkbox', onClick: run(() => insertCheckbox(view)) },
    { label: 'Add milestone', onClick: run(() => insertMilestone(view)) },
    { label: 'Log machine work…', onClick: openSub('machine') }
  ]
  if (ctx.isTask || ctx.isMilestone) {
    items.push(
      { separator: true },
      { label: 'Add tag…', onClick: openSub('tag') },
      { label: 'Set priority…', onClick: openSub('priority') },
      { label: 'Set due date…', onClick: openSub('date') }
    )
  }
  if (ctx.isMachine) {
    items.push(
      { separator: true },
      { label: 'Edit machine entry…', onClick: openSub('edit-machine') }
    )
  }
  return items
}

function checkboxItems(
  ctx: LineCtx,
  columns: BoardColumn[],
  choose: (col: BoardColumn) => void
): MenuEntry[] {
  const current = TASK_LINE_RE.exec(ctx.text)?.[3] ?? ' '
  const items: MenuEntry[] = columns.map((col) => ({
    label: col.name,
    checked: col.char === current,
    onClick: () => choose(col)
  }))
  items.push(
    { separator: true },
    {
      label: 'Archived',
      checked: current === ARCHIVED_CHAR,
      onClick: () => choose({ name: 'Archive', char: ARCHIVED_CHAR })
    }
  )
  return items
}
