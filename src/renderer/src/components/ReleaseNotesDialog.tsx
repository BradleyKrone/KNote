import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useReleaseNotesStore } from '@/stores/releaseNotesStore'
import { Md } from './reading/ReadingView'
import releaseNotesDoc from '../../../../resources/releaseNotes.md?raw'

export function ReleaseNotesDialog(): React.JSX.Element | null {
  const open = useReleaseNotesStore((s) => s.open)
  const setOpen = useReleaseNotesStore((s) => s.setOpen)

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
          Release notes
          <button className="icon-btn" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="welcome-body reading-content">
          <Md content={releaseNotesDoc} path="" depth={0} />
        </div>
      </div>
    </div>
  )
}
