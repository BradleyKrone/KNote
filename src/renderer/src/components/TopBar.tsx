import {
  Bold,
  BookOpen,
  CalendarDays,
  Code,
  Code2,
  Eye,
  Flag,
  Italic,
  Moon,
  PanelLeft,
  PanelRight,
  Strikethrough,
  Sun,
  Tag
} from 'lucide-react'
import { useState } from 'react'
import { DUE_RE } from '@shared/parser/patterns'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useUiStore } from '@/stores/uiStore'
import {
  decreaseFontSizeActive,
  formatActive,
  increaseFontSizeActive,
  insertTagOnActive,
  setDueDateOnActive,
  setPriorityOnActive
} from '@/editor/formatting'
import { getActiveEditorView } from '@/editor/activeView'
import { Popover } from '@/components/popover/Popover'
import { TagPickerContent } from '@/components/popover/TagPickerContent'
import { PriorityPickerContent } from '@/components/popover/PriorityPickerContent'
import { DatePickerContent } from '@/components/popover/DatePickerContent'
import { titleOf } from '@shared/pathUtils'

type PickerKind = 'tag' | 'priority' | 'date' | null

interface Props {
  onToggleSidebar: () => void
}

export function TopBar({ onToggleSidebar }: Props): React.JSX.Element {
  const { theme, toggleTheme } = useSettingsStore()
  const { note, dirty, mode, setMode, activeLineIsTask } = useWorkspaceStore()
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)
  const boardOpen = useUiStore((s) => s.boardOpen)
  const showFormatting = note !== null && !boardOpen && mode !== 'reading'
  const [openPicker, setOpenPicker] = useState<PickerKind>(null)
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null)

  const openPickerAt = (kind: PickerKind, e: React.MouseEvent<HTMLButtonElement>): void => {
    setPickerAnchor(e.currentTarget)
    setOpenPicker(kind)
  }
  const closePicker = (): void => {
    setOpenPicker(null)
    setPickerAnchor(null)
  }

  const currentLineDue = (): string | null => {
    const view = getActiveEditorView()
    if (!view) return null
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    const m = DUE_RE.exec(line.text)
    return m ? (m[1] ?? m[2]) : null
  }

  return (
    <div className="top-bar">
      <button className="icon-btn" title="Toggle sidebar" onClick={onToggleSidebar}>
        <PanelLeft size={16} />
      </button>
      {showFormatting && (
        <div className="format-toolbar">
          <button
            className="icon-btn"
            title="Bold (Ctrl+B)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => formatActive('bold')}
          >
            <Bold size={15} />
          </button>
          <button
            className="icon-btn"
            title="Italic (Ctrl+I)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => formatActive('italic')}
          >
            <Italic size={15} />
          </button>
          <button
            className="icon-btn"
            title="Strikethrough (Ctrl+Shift+X)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => formatActive('strike')}
          >
            <Strikethrough size={15} />
          </button>
          <button
            className="icon-btn"
            title="Inline code (Ctrl+`)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => formatActive('code')}
          >
            <Code size={15} />
          </button>
          <button
            className="icon-btn"
            title="Decrease font size of selection"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => decreaseFontSizeActive()}
          >
            <span className="format-fontsize-btn">A-</span>
          </button>
          <button
            className="icon-btn"
            title="Increase font size of selection"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => increaseFontSizeActive()}
          >
            <span className="format-fontsize-btn">A+</span>
          </button>
          <button
            className="icon-btn"
            title="Add tag"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => openPickerAt('tag', e)}
          >
            <Tag size={15} />
          </button>
          {activeLineIsTask && (
            <>
              <button
                className="icon-btn"
                title="Set priority"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => openPickerAt('priority', e)}
              >
                <Flag size={15} />
              </button>
              <button
                className="icon-btn"
                title="Set due date"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => openPickerAt('date', e)}
              >
                <CalendarDays size={15} />
              </button>
            </>
          )}
          {openPicker === 'tag' && (
            <Popover anchorEl={pickerAnchor} onClose={closePicker}>
              <TagPickerContent
                onSelect={(tag) => {
                  insertTagOnActive(tag)
                  closePicker()
                }}
              />
            </Popover>
          )}
          {openPicker === 'priority' && (
            <Popover anchorEl={pickerAnchor} onClose={closePicker}>
              <PriorityPickerContent
                onSelect={(level) => {
                  setPriorityOnActive(level)
                  closePicker()
                }}
              />
            </Popover>
          )}
          {openPicker === 'date' && (
            <Popover anchorEl={pickerAnchor} onClose={closePicker}>
              <DatePickerContent
                currentDate={currentLineDue()}
                onSelect={(date) => {
                  setDueDateOnActive(date)
                  closePicker()
                }}
              />
            </Popover>
          )}
        </div>
      )}
      <div className="top-bar-title">
        {note ? (
          <>
            <span className="note-title">{titleOf(note.path)}</span>
            {dirty && <span className="dirty-dot" title="Unsaved changes" />}
          </>
        ) : (
          <span className="note-title muted">KNote</span>
        )}
      </div>
      <div className="top-bar-actions">
        {note && (
          <button
            className="icon-btn"
            title={
              mode === 'live'
                ? 'Live preview — click for source mode'
                : mode === 'source'
                  ? 'Source mode — click for reading mode'
                  : 'Reading mode — click for live preview'
            }
            onClick={() =>
              setMode(mode === 'live' ? 'source' : mode === 'source' ? 'reading' : 'live')
            }
          >
            {mode === 'live' ? <Eye size={16} /> : mode === 'source' ? <Code2 size={16} /> : <BookOpen size={16} />}
          </button>
        )}
        <button className="icon-btn" title="Toggle theme" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {note && (
          <button className="icon-btn" title="Toggle right panel" onClick={toggleRightPanel}>
            <PanelRight size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
