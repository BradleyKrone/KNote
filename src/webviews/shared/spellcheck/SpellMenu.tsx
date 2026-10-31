// The right-click menu for a misspelled word in any box that isn't the note
// editor itself (that one folds the same items into EditorContextMenu): the
// task dialog's title, a table cell, a plain <input>/<textarea>. Opened
// imperatively — openSpellMenu() mounts a React root on first use — so a
// non-React caller like inputSpellCheck.ts can raise it without being wired
// into each webview's component tree.

import { useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BookPlus, Eye, SpellCheck } from 'lucide-react'
import { ContextMenuList, type MenuEntry } from '../components/ContextMenuList'
import { Popover } from '../components/Popover'
import { suggestWords } from './dictionary'
import { addToDictionary, ignoreSpelling } from './spellActions'

export interface SpellMenuRequest {
  /** Viewport point to open at (the right-click location). */
  x: number
  y: number
  word: string
  /** Swap the word for the chosen suggestion. */
  replace: (replacement: string) => void
}

const ICON = 14

let root: Root | null = null
let show: ((req: SpellMenuRequest | null) => void) | null = null
let pending: SpellMenuRequest | null = null

export function openSpellMenu(req: SpellMenuRequest): void {
  if (show) {
    show(req)
    return
  }
  pending = req
  if (!root) {
    const host = document.createElement('div')
    // Mounted at body level rather than inside whatever dialog holds the
    // field, so it must out-stack the modal overlay (z-index 2000) itself.
    host.style.position = 'relative'
    host.style.zIndex = '4000'
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(<SpellMenuHost />)
  }
}

function SpellMenuHost(): React.JSX.Element | null {
  const [req, setReq] = useState<SpellMenuRequest | null>(pending)
  useEffect(() => {
    show = setReq
    if (pending) setReq(pending)
    pending = null
    return () => {
      show = null
    }
  }, [])
  if (!req) return null
  const close = (): void => setReq(null)
  return (
    <Popover anchorPoint={{ x: req.x, y: req.y }} onClose={close}>
      {/* Keep focus in the field being corrected: a table cell commits and
          closes on blur, and an input needs focus for its native undo. */}
      <div onMouseDown={(e) => e.preventDefault()}>
        <ContextMenuList items={spellMenuItems(req, close)} />
      </div>
    </Popover>
  )
}

function spellMenuItems(req: SpellMenuRequest, close: () => void): MenuEntry[] {
  const suggestions = suggestWords(req.word)
  const items: MenuEntry[] = suggestions.length
    ? suggestions.map((s) => ({
        label: s,
        icon: <SpellCheck size={ICON} />,
        onClick: () => {
          close()
          req.replace(s)
        }
      }))
    : [{ label: 'No suggestions', detail: '', disabled: true, onClick: close }]
  items.push(
    { separator: true },
    {
      label: 'Add to dictionary',
      icon: <BookPlus size={ICON} />,
      onClick: () => {
        close()
        addToDictionary(req.word)
      }
    },
    {
      label: 'Ignore',
      icon: <Eye size={ICON} />,
      onClick: () => {
        close()
        ignoreSpelling(req.word)
      }
    }
  )
  return items
}
