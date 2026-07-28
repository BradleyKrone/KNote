// A small right-click menu: a flat list of clickable items (with optional
// leading icon, separators, a trailing check mark, and a danger style),
// rendered inside a Popover. Reuses the shared .picker / .picker-row styling.
// The old Electron app's ContextMenu.tsx is the model; this is its
// VS Code-webview counterpart.

export type MenuEntry =
  | {
      label: string
      /** Leading icon (a lucide-react element), shown left of the label. */
      icon?: React.ReactNode
      /** Right-aligned hint (e.g. a status char); ignored when `checked` is set. */
      detail?: string
      /** Show a trailing ✓ (e.g. the task's current Kanban column). */
      checked?: boolean
      danger?: boolean
      /** Greyed out and inert — e.g. Copy with nothing selected. */
      disabled?: boolean
      onClick: () => void
    }
  | { separator: true }

interface Props {
  items: MenuEntry[]
}

export function ContextMenuList({ items }: Props): React.JSX.Element {
  // Reserve the icon column for every row as soon as any row has an icon, so
  // labels stay on one vertical line instead of stepping in and out.
  const hasIcons = items.some((item) => !('separator' in item) && item.icon != null)

  return (
    <div className="picker context-menu">
      <div className="picker-list">
        {items.map((item, i) =>
          'separator' in item ? (
            <div key={i} className="menu-separator" role="separator" />
          ) : (
            <div
              key={i}
              className={`picker-row${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}`}
              aria-disabled={item.disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={item.disabled ? undefined : item.onClick}
            >
              {hasIcons && (
                <span className="picker-row-icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
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
