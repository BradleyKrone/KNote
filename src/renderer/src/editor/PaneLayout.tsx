// Lays out the editor area: a single pane, or two panes side by side
// (vertical split) / stacked (horizontal split), each with its own tab
// strip and editor. Clicking anywhere in a pane makes it the active one.

import { DashboardView } from '@/dashboard/DashboardView'
import { isDashboardTab, useWorkspaceStore } from '@/stores/workspaceStore'
import { EditorPane } from './EditorPane'
import { TabStrip } from './TabStrip'

function EmptyPane(): React.JSX.Element {
  return (
    <div className="empty-state">
      <p>No note is open</p>
      <p className="empty-hint">
        Select a note in the file explorer, or press Ctrl+O to jump to one.
      </p>
    </div>
  )
}

export function PaneLayout(): React.JSX.Element {
  const panes = useWorkspaceStore((s) => s.panes)
  const split = useWorkspaceStore((s) => s.split)
  const activePane = useWorkspaceStore((s) => s.activePane)
  const setActivePane = useWorkspaceStore((s) => s.setActivePane)

  return (
    <div className={`pane-layout${split ? ` split-${split}` : ''}`}>
      {panes.map((pane, i) => (
        <div
          key={i}
          className={`workspace-pane${panes.length > 1 && i === activePane ? ' active' : ''}`}
          onMouseDownCapture={() => setActivePane(i)}
        >
          <TabStrip paneIndex={i} />
          {isDashboardTab(pane.activeTab) ? (
            <DashboardView key={`${i}:dashboard`} paneIndex={i} />
          ) : pane.note ? (
            <EditorPane key={`${i}:${pane.note.path}`} paneIndex={i} />
          ) : (
            <EmptyPane />
          )}
        </div>
      ))}
    </div>
  )
}
