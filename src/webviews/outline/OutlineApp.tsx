// Heading tree for the note in the active editor. Follows the
// activeNoteChanged event; click a heading to jump the editor there.

import { useEffect, useState } from 'react'
import { isMarkdown } from '@shared/pathUtils'
import { host, on } from '../shared/rpc'
import { useIndexStore } from '../shared/stores'

export function OutlineApp({ initialNote }: { initialNote: string | null }): React.JSX.Element {
  const [notePath, setNotePath] = useState<string | null>(
    initialNote && isMarkdown(initialNote) ? initialNote : null
  )
  const notes = useIndexStore((s) => s.notes)

  useEffect(
    () =>
      on('activeNoteChanged', (path) => {
        if (path !== null && isMarkdown(path)) setNotePath(path)
      }),
    []
  )

  if (!notePath) {
    return <div className="panel-empty">Open a note to see its outline</div>
  }

  const headings = notes.get(notePath)?.headings ?? []

  if (headings.length === 0) {
    return <div className="panel-empty">No headings in this note</div>
  }

  return (
    <div className="side-panel">
      <div className="side-panel-body">
        {headings.map((h, i) => (
          <div
            key={`${h.line}-${i}`}
            className="outline-row"
            style={{ paddingLeft: (h.level - 1) * 12 + 8 }}
            onClick={() => void host.openNote(notePath, h.line)}
          >
            {h.text}
          </div>
        ))}
      </div>
    </div>
  )
}
