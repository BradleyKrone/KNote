// A small right-click menu: a flat list of clickable items (with optional
// separators, a trailing check mark, and a danger style), rendered inside a
// Popover. Reuses the shared .picker / .picker-row styling. The old Electron
// app's ContextMenu.tsx is the model; this is its VS Code-webview counterpart.

export type MenuEntry =
  | {
      label: string
      /** Right-aligned hint (e.g. a status char); ignored when `checked` is set. */
      detail?: string
      /** Show a trailing ✓ (e.g. the task's current Kanban column). */
      checked?: boolean
      danger?: boolean
      onClick: () => void
    }
  | { separator: true }

interface Props {
  items: MenuEntry[]
}

export function ContextMenuList({ items }: Props): React.JSX.Element {
  return (
    <div className="picker context-menu">
      <div className="picker-list">
        {items.map((item, i) =>
          'separator' in item ? (
            <div key={i} className="menu-separator" role="separator" />
          ) : (
            <div
              key={i}
              className={`picker-row${item.danger ? ' danger' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={item.onClick}
            >
              <span className="picker-row-label">{item.label}</span>
              {(item.checked || item.detail) && (
                <span className="picker-row-detail">{item.checked ? '✓' : item.detail}</span>
              )}
            </div>
          )
        )}
      </div>
    </div>
  )
}
