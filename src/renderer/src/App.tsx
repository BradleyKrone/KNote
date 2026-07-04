import { useEffect, useRef, useState } from 'react'
import {
  CalendarDays,
  CalendarRange,
  Files,
  FolderOpen,
  Hash,
  Search,
  Settings,
  Trello,
  Truck
} from 'lucide-react'
import { initVault, scheduleTreeRefresh, useVaultStore } from './stores/vaultStore'
import { initSettings } from './stores/settingsStore'
import { useWorkspaceStore } from './stores/workspaceStore'
import { useIndexStore } from './stores/indexStore'
import { useUiStore, type SidebarTab } from './stores/uiStore'
import { VaultPicker } from './components/VaultPicker'
import { FileExplorer } from './components/explorer/FileExplorer'
import { TopBar } from './components/TopBar'
import { EditorPane } from './editor/EditorPane'
import { QuickSwitcher } from './components/palette/QuickSwitcher'
import { CommandPalette } from './components/palette/CommandPalette'
import { TemplatePicker } from './components/palette/TemplatePicker'
import { SettingsModal } from './components/SettingsModal'
import { WelcomeDialog } from './components/WelcomeDialog'
import { ConfirmDialog } from './components/ConfirmDialog'
import { registerCoreCommands } from './commands/coreCommands'
import { runCommand } from './commands/registry'
import { openThisWeekNote } from './commands/weeklyNotes'
import { useSettingsStore } from './stores/settingsStore'
import { SearchPanel } from './components/panels/SearchPanel'
import { BoardView } from './board/BoardView'
import { TimelineView } from './timeline/TimelineView'
import { MachineLogView } from './machineLog/MachineLogView'
import { TagPane } from './components/panels/TagPane'
import { BacklinksPanel } from './components/panels/BacklinksPanel'
import { PropertiesPanel } from './components/panels/PropertiesPanel'

const MIN_SIDEBAR = 160
const MAX_SIDEBAR = 480

const SIDEBAR_TABS: Array<{ id: SidebarTab; icon: React.JSX.Element; title: string }> = [
  { id: 'files', icon: <Files size={22} />, title: 'Files' },
  { id: 'search', icon: <Search size={22} />, title: 'Search' },
  { id: 'tags', icon: <Hash size={22} />, title: 'Tags' }
]

export default function App(): React.JSX.Element {
  const { vault, loading } = useVaultStore()
  const note = useWorkspaceStore((s) => s.note)
  const {
    sidebarTab,
    setSidebarTab,
    rightPanelOpen,
    setQuickSwitcherOpen,
    boardOpen,
    timelineOpen,
    machineLogOpen,
    toast
  } = useUiStore()
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const dragging = useRef(false)

  useEffect(() => {
    registerCoreCommands()
    void initSettings()
    void initVault()
  }, [])

  // External filesystem changes: refresh the tree, reconcile the open note
  useEffect(() => {
    return window.knote.onExternalChange((change) => {
      scheduleTreeRefresh()
      void useWorkspaceStore.getState().handleExternalChange(change.path, change.kind)
    })
  }, [])

  // Note metadata updates from the main-process indexer
  useEffect(() => {
    return window.knote.onIndexDelta((delta) => {
      useIndexStore.getState().applyDelta(delta)
    })
  }, [])

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'o') {
        e.preventDefault()
        setQuickSwitcherOpen(true)
      } else if (key === 'p' && !e.shiftKey) {
        e.preventDefault()
        useUiStore.getState().setCommandPaletteOpen(true)
      } else if (key === 'e') {
        e.preventDefault()
        runCommand('mode-reading')
      } else if (key === 'n') {
        e.preventDefault()
        runCommand('new-note')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setQuickSwitcherOpen])

  useEffect(() => {
    const move = (e: MouseEvent): void => {
      if (!dragging.current) return
      setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, e.clientX - 40)))
    }
    const up = (): void => {
      dragging.current = false
      document.body.classList.remove('resizing')
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  if (loading) return <div className="app-loading" />
  if (!vault) return <VaultPicker />

  return (
    <div className="app-layout">
      <div className="ribbon">
        {SIDEBAR_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`icon-btn ribbon-btn${sidebarOpen && sidebarTab === tab.id ? ' active' : ''}`}
            title={tab.title}
            onClick={() => {
              if (sidebarOpen && sidebarTab === tab.id) setSidebarOpen(false)
              else {
                setSidebarOpen(true)
                setSidebarTab(tab.id)
              }
            }}
          >
            {tab.icon}
          </button>
        ))}
        <button
          className="icon-btn ribbon-btn"
          title="Open this week's note"
          onClick={() => void openThisWeekNote()}
        >
          <CalendarDays size={22} />
        </button>
        <div className="ribbon-divider" />
        <button
          className={`icon-btn ribbon-btn${boardOpen ? ' active' : ''}`}
          title={boardOpen ? 'Back to notes' : 'Open Kanban board'}
          onClick={() => {
            if (boardOpen) useUiStore.getState().setBoardOpen(false)
            else useUiStore.getState().openBoard({ kind: 'global' })
          }}
        >
          <Trello size={22} />
        </button>
        <button
          className={`icon-btn ribbon-btn${timelineOpen ? ' active' : ''}`}
          title={timelineOpen ? 'Back to notes' : 'Open timeline'}
          onClick={() => useUiStore.getState().setTimelineOpen(!timelineOpen)}
        >
          <CalendarRange size={22} />
        </button>
        <button
          className={`icon-btn ribbon-btn${machineLogOpen ? ' active' : ''}`}
          title={machineLogOpen ? 'Back to notes' : 'Open machine log'}
          onClick={() => useUiStore.getState().setMachineLogOpen(!machineLogOpen)}
        >
          <Truck size={22} />
        </button>
        <div className="ribbon-spacer" />
        <button
          className="icon-btn ribbon-btn"
          title="Open another vault…"
          onClick={() => runCommand('open-vault')}
        >
          <FolderOpen size={22} />
        </button>
        <button
          className="icon-btn ribbon-btn"
          title="Settings"
          onClick={() => useSettingsStore.getState().setSettingsOpen(true)}
        >
          <Settings size={22} />
        </button>
      </div>
      {sidebarOpen && (
        <>
          <div className="sidebar" style={{ width: sidebarWidth }}>
            {sidebarTab === 'files' && <FileExplorer />}
            {sidebarTab === 'search' && <SearchPanel />}
            {sidebarTab === 'tags' && <TagPane />}
          </div>
          <div
            className="sidebar-resizer"
            onMouseDown={() => {
              dragging.current = true
              document.body.classList.add('resizing')
            }}
          />
        </>
      )}
      <div className="main-area">
        <TopBar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((v) => !v)} />
        {boardOpen ? (
          <BoardView />
        ) : timelineOpen ? (
          <TimelineView />
        ) : machineLogOpen ? (
          <MachineLogView />
        ) : (
          <div className="content-row">
            <div className="editor-column">
              {note ? (
                <EditorPane key={note.path} />
              ) : (
                <div className="empty-state">
                  <p>No note is open</p>
                  <p className="empty-hint">
                    Select a note in the file explorer, or press Ctrl+O to jump to one.
                  </p>
                </div>
              )}
            </div>
            {rightPanelOpen && note && (
              <div className="right-panel">
                <PropertiesPanel />
                <BacklinksPanel />
              </div>
            )}
          </div>
        )}
      </div>
      <QuickSwitcher />
      <CommandPalette />
      <TemplatePicker />
      <SettingsModal />
      <WelcomeDialog />
      <ConfirmDialog />
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
