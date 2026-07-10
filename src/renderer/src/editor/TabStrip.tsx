// The tab strip above one pane's editor: one tab per open note in that
// pane. Click activates, middle-click or the × closes, the active tab shows
// a dirty dot while unsaved.

import { X } from 'lucide-react'
import { titleOf } from '@shared/pathUtils'
import { useWorkspaceStore } from '@/stores/workspaceStore'

export function TabStrip({ paneIndex }: { paneIndex: number }): React.JSX.Element | null {
  const pane = useWorkspaceStore((s) => s.panes[paneIndex])
  const setActivePane = useWorkspaceStore((s) => s.setActivePane)
  if (!pane || pane.tabs.length === 0) return null

  const activePath = pane.note?.path ?? null

  return (
    <div className="tab-strip">
      {pane.tabs.map((path) => {
        const isActive = activePath !== null && path === activePath
        return (
          <div
            key={path}
            className={`tab${isActive ? ' active' : ''}`}
            title={path}
            onClick={() => {
              setActivePane(paneIndex)
              if (!isActive) void useWorkspaceStore.getState().openFileInPane(paneIndex, path)
            }}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                useWorkspaceStore.getState().closeTab(paneIndex, path)
              }
            }}
          >
            <span className="tab-title">{titleOf(path)}</span>
            {isActive && pane.dirty && <span className="tab-dirty" />}
            <button
              className="tab-close"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation()
                useWorkspaceStore.getState().closeTab(paneIndex, path)
              }}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
