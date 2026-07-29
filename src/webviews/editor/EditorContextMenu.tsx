// The live-preview editor's right-click menu. Attaches a `contextmenu` listener
// to the CodeMirror DOM, reads the line under the click to decide which items
// apply (task/milestone → tag/priority/due; 🚜 line → edit machine; a checkbox
// glyph → the Kanban status switcher), and renders the menu — plus any picker an
// item opens — inside the shared Popover. Reproduces the old Electron app's
// editor context menu (src/renderer/src/editor/contextMenu.ts).

import { useEffect, useState } from 'react'
import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  BookPlus,
  Bold,
  CalendarDays,
  CheckSquare,
  Clipboard,
  Code,
  Columns3,
  Copy,
  ExternalLink,
  Eye,
  Flag,
  Italic,
  Link,
  Link2,
  Milestone,
  Pencil,
  Rows3,
  Scissors,
  SpellCheck,
  Strikethrough,
  Table2,
  Tag,
  Trash2,
  Truck,
  Unlink,
  Wrench
} from 'lucide-react'
import type { BoardColumn } from '@shared/types'
import {
  ARCHIVED_CHAR,
  MACHINE_ENTRY_RE,
  MILESTONE_LINE_RE,
  TASK_LINE_RE
} from '@shared/parser/patterns'
import { Popover } from '../shared/components/Popover'
import { ContextMenuList, type MenuEntry } from '../shared/components/ContextMenuList'
import { LinkPickerContent } from '../shared/components/LinkPickerContent'
import { DatePickerContent } from '../shared/components/DatePickerContent'
import { PriorityPickerContent } from '../shared/components/PriorityPickerContent'
import { TagPickerContent } from '../shared/components/TagPickerContent'
import { MachineEntryPickerContent } from '../machineLog/MachineEntryPickerContent'
import { TablePickerContent } from './TablePickerContent'
import { useConfigStore, showToast } from '../shared/stores'
import { titleOf } from '@shared/pathUtils'
import { host } from '../shared/rpc'
import { toggleWrap } from './markdownFormatting'
import { mdLinkAt, type MdLink } from './mdLinkLogic'
import { setCheckboxStatus, setSubtaskChecked, getNotePath } from './knoteConstructs'
import { copyTaskLink } from './taskLink'
import { misspelledRangeAt, type WordSpan } from './spellcheck/spellCheck'
import { suggestWords } from './spellcheck/dictionary'
import { addToDictionary, ignoreSpelling, replaceWord } from './spellcheck/spellActions'
import { copySelection, cutSelection, pasteAtSelection } from './clipboard'
import {
  addLineTag,
  editMachineOnLine,
  insertCheckbox,
  insertMachineEntry,
  insertMarkdownLink,
  insertMilestone,
  insertWikiLink,
  lineDue,
  removeMarkdownLink,
  replaceMarkdownLink,
  setLineDue,
  setLinePriority
} from './editorActions'
import { commitActiveCell, setTableSource } from './tableCellEdit'
import {
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  insertTableAt,
  readTableCtx,
  type TableCtx
} from './tableEdit'

/** The line under the right-click, captured when the menu opens. */
interface LineCtx {
  line0: number
  text: string
  isTask: boolean
  isSubtask: boolean
  isMilestone: boolean
  isMachine: boolean
  due: string | null
  serial: string
  /** The `[text](url)` hyperlink under the click, if any. */
  link: MdLink | null
  /** Selected text when the menu opened — pre-fills a new link's label. */
  selection: string
}

type Point = { x: number; y: number }
type SubKind = 'machine' | 'edit-machine' | 'date' | 'priority' | 'tag' | 'link' | 'table'

type OpenState =
  | {
      stage: 'menu'
      onCheckbox: boolean
      spell: WordSpan | null
      table: TableCtx | null
      point: Point
      ctx: LineCtx
    }
  | { stage: 'sub'; sub: SubKind; point: Point; ctx: LineCtx }
  | null

function readLineCtx(view: EditorView, pos: number): LineCtx {
  const line = view.state.doc.lineAt(pos)
  const task = TASK_LINE_RE.exec(line.text)
  const { from, to } = view.state.selection.main
  return {
    link: mdLinkAt(line.text, line.from, pos),
    selection: view.state.sliceDoc(from, to),
    line0: line.number - 1,
    text: line.text,
    isTask: task != null,
    isSubtask: task != null && task[1].length > 0,
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
      // Flush any live table cell first: the Popover is about to take focus,
      // and a commit landing after the context below was captured would leave
      // every table offset in it stale.
      commitActiveCell(view)
      const point = { x: e.clientX, y: e.clientY }
      const pos = view.posAtCoords(point) ?? view.state.selection.main.head
      // Place the caret where the user clicked (unless they have a selection),
      // so inserts and line edits land on the clicked line.
      if (view.state.selection.main.empty) {
        view.dispatch({ selection: EditorSelection.cursor(pos) })
      }
      const target = e.target as HTMLElement | null
      const onCheckbox = target?.closest('.cm-knote-check') != null
      const spell = onCheckbox ? null : misspelledRangeAt(view, pos)
      const table = onCheckbox ? null : readTableCtx(view, pos, target)
      setOpen({ stage: 'menu', onCheckbox, spell, table, point, ctx: readLineCtx(view, pos) })
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
    let items: MenuEntry[]
    if (open.onCheckbox && ctx.isSubtask) {
      items = subtaskCheckboxItems(ctx, (checked) => {
        close()
        void setSubtaskChecked(ctx.line0, ctx.text, checked)
      })
    } else if (open.onCheckbox) {
      items = checkboxItems(ctx, columns, (col) => {
        close()
        void setCheckboxStatus(ctx.line0, ctx.text, col)
      })
    } else if (open.spell) {
      items = [...spellItems(view, open.spell, close), ...mainItems(view, ctx, run, openSub)]
    } else if (ctx.link) {
      items = [...linkItems(view, ctx.link, run, openSub), ...mainItems(view, ctx, run, openSub)]
    } else {
      items = mainItems(view, ctx, run, openSub)
    }
    if (open.table) items = [...items, ...tableItems(view, open.table, run)]
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
      {open.sub === 'link' && (
        <LinkPickerContent
          initialText={ctx.link ? ctx.link.text : ctx.selection}
          initialUrl={ctx.link?.url}
          submitLabel={ctx.link ? 'Save' : 'Insert link'}
          onSubmit={(text, url) => {
            close()
            if (ctx.link) replaceMarkdownLink(view, ctx.link, text, url)
            else insertMarkdownLink(view, text, url)
          }}
        />
      )}
      {open.sub === 'table' && (
        <TablePickerContent
          onSubmit={(rows, cols) => {
            close()
            insertTableAt(view, rows, cols)
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

/**
 * Items shown above the normal menu when the right-click lands on a
 * `[text](url)` hyperlink, closed off with a separator (same shape as
 * spellItems). "Copy link" puts the bare URL on the clipboard — the target,
 * not the markdown — so it can be pasted anywhere.
 */
function linkItems(
  view: EditorView,
  link: MdLink,
  run: (fn: () => void) => () => void,
  openSub: (sub: SubKind) => () => void
): MenuEntry[] {
  return [
    {
      label: 'Open link',
      icon: <ExternalLink size={ICON} />,
      onClick: run(() => void host.openExternal(link.url))
    },
    {
      label: 'Copy link',
      icon: <Copy size={ICON} />,
      onClick: run(() => {
        void host.copyToClipboard(link.url).then(() => showToast(`Copied link: ${link.url}`))
      })
    },
    { label: 'Edit link…', icon: <Pencil size={ICON} />, onClick: openSub('link') },
    {
      label: 'Remove link',
      icon: <Unlink size={ICON} />,
      onClick: run(() => removeMarkdownLink(view, link))
    },
    { separator: true }
  ]
}

/**
 * Row/column items appended when the right-click lands inside a table (either
 * the rendered `<table>` or the raw pipes shown while it's being edited).
 * The header/delimiter line only gets column actions plus "insert row below"
 * — there's no row above the header to insert, and the header can't be deleted.
 */
function tableItems(
  view: EditorView,
  table: TableCtx,
  run: (fn: () => void) => () => void
): MenuEntry[] {
  const items: MenuEntry[] = [{ separator: true }]
  if (table.rowIndex >= 0) {
    items.push({
      label: 'Insert row above',
      icon: <Rows3 size={ICON} />,
      onClick: run(() => insertRow(view, table, table.rowIndex))
    })
  }
  items.push({
    label: 'Insert row below',
    icon: <Rows3 size={ICON} />,
    onClick: run(() => insertRow(view, table, table.rowIndex + 1))
  })
  if (table.rowIndex >= 0) {
    items.push({
      label: 'Delete row',
      icon: <Trash2 size={ICON} />,
      onClick: run(() => deleteRow(view, table, table.rowIndex))
    })
  }
  items.push(
    { separator: true },
    {
      label: 'Insert column left',
      icon: <Columns3 size={ICON} />,
      onClick: run(() => insertColumn(view, table, table.colIndex))
    },
    {
      label: 'Insert column right',
      icon: <Columns3 size={ICON} />,
      onClick: run(() => insertColumn(view, table, table.colIndex + 1))
    },
    {
      label: 'Delete column',
      icon: <Trash2 size={ICON} />,
      disabled: table.table.header.length <= 1,
      onClick: run(() => deleteColumn(view, table, table.colIndex))
    },
    { separator: true },
    {
      // The escape hatch out of cell-by-cell editing: a rendered table never
      // falls back to raw pipes on its own any more.
      label: 'Edit table source',
      icon: <Code size={ICON} />,
      onClick: run(() => {
        view.dispatch({
          effects: setTableSource.of(table.tableFrom),
          selection: EditorSelection.cursor(table.tableFrom)
        })
        view.focus()
      })
    }
  )
  return items
}

/**
 * Spell-check items shown above the normal menu when the right-click lands on a
 * misspelled word: up to a handful of suggested corrections, then "Add to
 * dictionary" / "Ignore", closed off with a separator.
 */
function spellItems(view: EditorView, span: WordSpan, close: () => void): MenuEntry[] {
  const suggestions = suggestWords(span.word)
  const items: MenuEntry[] = suggestions.length
    ? suggestions.map((s) => ({
        label: s,
        icon: <SpellCheck size={ICON} />,
        onClick: () => {
          close()
          replaceWord(view, span, s)
        }
      }))
    : [{ label: 'No suggestions', detail: '', disabled: true, onClick: close }]
  items.push(
    { separator: true },
    {
      label: 'Add to dictionary',
      icon: <BookPlus size={ICON} />,
      onClick: () => {
        close()
        addToDictionary(span.word)
      }
    },
    {
      label: 'Ignore',
      icon: <Eye size={ICON} />,
      onClick: () => {
        close()
        ignoreSpelling(view, span.word)
      }
    },
    { separator: true }
  )
  return items
}

const ICON = 14

/**
 * Cut / Copy / Paste, at the top of every menu the way a native editor menu
 * has them. Cut and Copy grey out with nothing selected rather than vanishing,
 * so the group keeps a constant shape. (Ctrl+X/C/V work regardless —
 * CodeMirror handles those itself.)
 */
function clipboardItems(
  view: EditorView,
  hasSelection: boolean,
  run: (fn: () => void) => () => void
): MenuEntry[] {
  return [
    {
      label: 'Cut',
      icon: <Scissors size={ICON} />,
      disabled: !hasSelection,
      onClick: run(() => cutSelection(view))
    },
    {
      label: 'Copy',
      icon: <Copy size={ICON} />,
      disabled: !hasSelection,
      onClick: run(() => copySelection(view))
    },
    {
      label: 'Paste',
      icon: <Clipboard size={ICON} />,
      onClick: run(() => void pasteAtSelection(view))
    },
    { separator: true }
  ]
}

function mainItems(
  view: EditorView,
  ctx: LineCtx,
  run: (fn: () => void) => () => void,
  openSub: (sub: SubKind) => () => void
): MenuEntry[] {
  const items: MenuEntry[] = [
    ...clipboardItems(view, ctx.selection.length > 0, run),
    { label: 'Bold', icon: <Bold size={ICON} />, onClick: run(() => toggleWrap(view, '**')) },
    { label: 'Italic', icon: <Italic size={ICON} />, onClick: run(() => toggleWrap(view, '*')) },
    {
      label: 'Strikethrough',
      icon: <Strikethrough size={ICON} />,
      onClick: run(() => toggleWrap(view, '~~'))
    },
    { label: 'Inline code', icon: <Code size={ICON} />, onClick: run(() => toggleWrap(view, '`')) },
    {
      label: 'Insert wiki link',
      icon: <Link2 size={ICON} />,
      onClick: run(() => insertWikiLink(view))
    },
    { label: 'Insert link…', icon: <Link size={ICON} />, onClick: openSub('link') },
    { separator: true },
    {
      label: 'Add checkbox',
      icon: <CheckSquare size={ICON} />,
      onClick: run(() => insertCheckbox(view))
    },
    {
      label: 'Add milestone',
      icon: <Milestone size={ICON} />,
      onClick: run(() => insertMilestone(view))
    },
    { label: 'Log machine work…', icon: <Truck size={ICON} />, onClick: openSub('machine') },
    { label: 'Insert table…', icon: <Table2 size={ICON} />, onClick: openSub('table') }
  ]
  if (ctx.isTask || ctx.isMilestone) {
    items.push(
      { separator: true },
      { label: 'Add tag…', icon: <Tag size={ICON} />, onClick: openSub('tag') },
      { label: 'Set priority…', icon: <Flag size={ICON} />, onClick: openSub('priority') },
      { label: 'Set due date…', icon: <CalendarDays size={ICON} />, onClick: openSub('date') }
    )
    // Only top-level tasks and milestones are linkable — sub-tasks are plain
    // toggles, not standalone items, so they get no anchor.
    if (!ctx.isSubtask) {
      items.push({
        label: ctx.isMilestone ? 'Copy link to milestone' : 'Copy link to task',
        icon: <Link2 size={ICON} />,
        onClick: run(() => copyTaskLink(view, ctx.line0, titleOf(getNotePath() ?? '')))
      })
    }
  }
  if (ctx.isMachine) {
    items.push(
      { separator: true },
      {
        label: 'Edit machine entry…',
        icon: <Wrench size={ICON} />,
        onClick: openSub('edit-machine')
      }
    )
  }
  return items
}

/** A sub-task's checkbox menu: just the two plain states, no Kanban columns. */
function subtaskCheckboxItems(ctx: LineCtx, choose: (checked: boolean) => void): MenuEntry[] {
  const current = TASK_LINE_RE.exec(ctx.text)?.[3] ?? ' '
  const done = current === 'x' || current === 'X'
  return [
    { label: 'Unchecked', checked: !done, onClick: () => choose(false) },
    { label: 'Checked', checked: done, onClick: () => choose(true) }
  ]
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
