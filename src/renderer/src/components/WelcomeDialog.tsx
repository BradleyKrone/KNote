import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useWelcomeStore } from '@/stores/welcomeStore'
import { Md } from './reading/ReadingView'
import welcomeDoc from '../../../../resources/welcome.md?raw'

export function WelcomeDialog(): React.JSX.Element | null {
  const open = useWelcomeStore((s) => s.open)
  const setOpen = useWelcomeStore((s) => s.setOpen)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  return (
    <div className="modal-overlay" onMouseDown={() => setOpen(false)}>
      <div className="modal-panel welcome-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-title">
          Welcome & feature guide
          <button className="icon-btn" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="welcome-body reading-content">
          <Md content={welcomeDoc} path="" depth={0} />
        </div>
      </div>
    </div>
  )
}
