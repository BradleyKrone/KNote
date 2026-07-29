// A small right-click menu: clickable items (with optional leading icon,
// separators, a trailing check mark, and a danger style) plus submenus, which
// fly out to the side on hover the way Obsidian's editor menu groups its
// actions. Rendered inside a Popover, reusing the shared .picker / .picker-row
// styling. The old Electron app's ContextMenu.tsx is the model; this is its
// VS Code-webview counterpart.

import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'

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
  | {
      label: string
      icon?: React.ReactNode
      /** Nested items, opened as a flyout instead of running an action. */
      submenu: MenuEntry[]
      disabled?: boolean
    }
  | { separator: true }

interface Props {
  items: MenuEntry[]
}

export function ContextMenuList({ items }: Props): React.JSX.Element {
  // Reserve the icon column for every row as soon as any row has an icon, so
  // labels stay on one vertical line instead of stepping in and out.
  const hasIcons = items.some((item) => !('separator' in item) && item.icon != null)
  // At most one flyout at a time: hovering any other row closes the last one.
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <div className="picker context-menu">
      {/* A flyout is a DOM child of its row, so moving the pointer into one
          never counts as leaving the list — only leaving the menu proper. */}
      <div className="picker-list" onMouseLeave={() => setOpenIndex(null)}>
        {items.map((item, i) =>
          'separator' in item ? (
            <div key={i} className="menu-separator" role="separator" />
          ) : 'submenu' in item ? (
            <SubmenuRow
              key={i}
              item={item}
              hasIcons={hasIcons}
              open={openIndex === i}
              onOpen={() => setOpenIndex(i)}
              onToggle={() => setOpenIndex(openIndex === i ? null : i)}
            />
          ) : (
            <div
              key={i}
              className={`picker-row${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}`}
              aria-disabled={item.disabled}
              onMouseEnter={() => setOpenIndex(null)}
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

interface SubmenuProps {
  item: { label: string; icon?: React.ReactNode; submenu: MenuEntry[]; disabled?: boolean }
  hasIcons: boolean
  open: boolean
  onOpen: () => void
  onToggle: () => void
}

/**
 * A row that opens its children beside it. Hover opens it (a click toggles,
 * for keyboard and touch); the flyout lives inside the row, so the pointer can
 * travel from one to the other without the row counting as left.
 */
function SubmenuRow({ item, hasIcons, open, onOpen, onToggle }: SubmenuProps): React.JSX.Element {
  return (
    <div
      className={`picker-row has-submenu${item.disabled ? ' disabled' : ''}`}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-disabled={item.disabled}
      onMouseEnter={item.disabled ? undefined : onOpen}
      onMouseDown={(e) => e.preventDefault()}
      onClick={item.disabled ? undefined : onToggle}
    >
      {hasIcons && (
        <span className="picker-row-icon" aria-hidden="true">
          {item.icon}
        </span>
      )}
      <span className="picker-row-label">{item.label}</span>
      <span className="picker-row-chevron" aria-hidden="true">
        <ChevronRight size={14} />
      </span>
      {open && <Flyout items={item.submenu} />}
    </div>
  )
}

/**
 * The nested list itself, kept on screen: the parent Popover drops the menu at
 * the raw click point without clamping, so a flyout near the window's edge has
 * to flip to the other side and slide up on its own.
 */
function Flyout({ items }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<{ flip: boolean; shift: number }>({
    flip: false,
    shift: 0
  })

  // Measured once, on the natural position: re-measuring after flipping would
  // see a flyout that now fits and flip it straight back, forever.
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const overflowY = rect.bottom - window.innerHeight
    setPlacement({
      flip: rect.right > window.innerWidth,
      shift: overflowY > 0 ? -Math.min(overflowY + 8, rect.top) : 0
    })
  }, [items])

  return (
    <div
      ref={ref}
      className={`popover-panel submenu-flyout${placement.flip ? ' flip-left' : ''}`}
      style={{ marginTop: placement.shift }}
      onClick={(e) => e.stopPropagation()}
    >
      <ContextMenuList items={items} />
    </div>
  )
}
