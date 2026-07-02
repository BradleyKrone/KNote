import {
  Bold,
  BookOpen,
  Code,
  Code2,
  Eye,
  Italic,
  Moon,
  PanelLeft,
  PanelRight,
  Strikethrough,
  Sun
} from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useUiStore } from '@/stores/uiStore'
import { formatActive } from '@/editor/formatting'
import { titleOf } from '@shared/pathUtils'

interface Props {
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

export function TopBar({ onToggleSidebar }: Props): React.JSX.Element {
  const { theme, toggleTheme } = useSettingsStore()
  const { note, dirty, mode, setMode } = useWorkspaceStore()
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)
  const boardOpen = useUiStore((s) => s.boardOpen)
  const showFormatting = note !== null && !boardOpen && mode !== 'reading'

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
