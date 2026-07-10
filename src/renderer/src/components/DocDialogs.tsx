import { X } from 'lucide-react'
import { useReleaseNotesStore, useWelcomeStore } from '@/stores/docDialogs'
import { useEscapeToClose } from '@/hooks/useEscapeToClose'
import { Md } from './reading/ReadingView'
import welcomeDoc from '../../../../resources/welcome.md?raw'
import releaseNotesDoc from '../../../../resources/releaseNotes.md?raw'

// Read-only dialogs for docs bundled with the app itself (not vault files):
// the welcome/feature guide and the release notes, both opened from
// Settings → General.

interface MarkdownDialogProps {
  open: boolean
  onClose: () => void
  title: string
  content: string
}

function MarkdownDialog({
  open,
  onClose,
  title,
  content
}: MarkdownDialogProps): React.JSX.Element | null {
  useEscapeToClose(open, onClose)
  if (!open) return null

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-panel welcome-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-title">
          {title}
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="welcome-body reading-content">
          <Md content={content} path="" depth={0} />
        </div>
      </div>
    </div>
  )
}

export function WelcomeDialog(): React.JSX.Element | null {
  const open = useWelcomeStore((s) => s.open)
  const setOpen = useWelcomeStore((s) => s.setOpen)
  return (
    <MarkdownDialog
      open={open}
      onClose={() => setOpen(false)}
      title="Welcome & feature guide"
      content={welcomeDoc}
    />
  )
}

export function ReleaseNotesDialog(): React.JSX.Element | null {
  const open = useReleaseNotesStore((s) => s.open)
  const setOpen = useReleaseNotesStore((s) => s.setOpen)
  return (
    <MarkdownDialog
      open={open}
      onClose={() => setOpen(false)}
      title="Release notes"
      content={releaseNotesDoc}
    />
  )
}
