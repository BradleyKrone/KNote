// The tab strip above one pane's editor: one tab per open note in that
// pane. Click activates, middle-click or the × closes, the active tab shows
// a dirty dot while unsaved.

import { useState } from 'react'
import { LayoutDashboard, SplitSquareHorizontal, X } from 'lucide-react'
import { titleOf } from '@shared/pathUtils'
import type { VaultPath } from '@shared/types'
import { isDashboardTab, useWorkspaceStore } from '@/stores/workspaceStore'
import { ContextMenu, type MenuItem } from '@/components/ContextMenu'

export function TabStrip({ paneIndex }: { paneIndex: number }): React.JSX.Element | null {
  const pane = useWorkspaceStore((s) => s.panes[paneIndex])
  const setActivePane = useWorkspaceStore((s) => s.setActivePane)
  const [menu, setMenu] = useState<{ x: number; y: number; path: VaultPath } | null>(null)
  if (!pane || pane.tabs.length === 0) return null

  const activePath = pane.activeTab

  const menuItems: MenuItem[] = menu
    ? [
        {
          label: 'Split vertically',
          icon: SplitSquareHorizontal,
          onClick: () => void useWorkspaceStore.getState().openInSplit(menu.path, 'vertical')
        },
        {
          label: 'Close tab',
          icon: X,
          onClick: () => useWorkspaceStore.getState().closeTab(paneIndex, menu.path)
        }
      ]
    : []

  return (
    <div className="tab-strip">
      {pane.tabs.map((path) => {
        const isActive = activePath !== null && path === activePath
        return (
          <div
            key={path}
            className={`tab${isActive ? ' active' : ''}`}
            title={isDashboardTab(path) ? 'Dashboard' : path}
            onClick={() => {
              setActivePane(paneIndex)
              if (!isActive) void useWorkspaceStore.getState().activateTab(paneIndex, path)
            }}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                useWorkspaceStore.getState().closeTab(paneIndex, path)
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({ x: e.clientX, y: e.clientY, path })
            }}
          >
            {isDashboardTab(path) && <LayoutDashboard size={13} className="tab-icon" />}
            <span className="tab-title">{isDashboardTab(path) ? 'Dashboard' : titleOf(path)}</span>
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
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
