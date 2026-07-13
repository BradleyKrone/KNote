import { useEffect, useRef } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface MenuItem {
  label: string
  icon?: LucideIcon
  danger?: boolean
  onClick: () => void
}

export interface MenuSeparator {
  separator: true
}

export type MenuEntry = MenuItem | MenuSeparator

interface Props {
  x: number
  y: number
  items: MenuEntry[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  // Keep the menu on screen
  const estimatedHeight = items.reduce((h, entry) => h + ('separator' in entry ? 9 : 30), 0) + 12
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 180),
    top: Math.min(y, window.innerHeight - estimatedHeight)
  }

  return (
    <div ref={ref} className="context-menu" style={style}>
      {items.map((entry, i) =>
        'separator' in entry ? (
          <div key={`sep-${i}`} className="context-menu-separator" />
        ) : (
          <button
            key={entry.label}
            className={`context-menu-item${entry.danger ? ' danger' : ''}`}
            onClick={() => {
              onClose()
              entry.onClick()
            }}
          >
            <span className="context-menu-item-icon">
              {entry.icon ? <entry.icon size={14} /> : null}
            </span>
            {entry.label}
          </button>
        )
      )}
    </div>
  )
}
