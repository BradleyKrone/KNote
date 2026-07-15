// Backlinks + unlinked mentions for the note in the active editor. Follows
// the activeNoteChanged event; ignores non-note editors (board panels,
// settings) so the panel doesn't blank out while you work the board.

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Mention } from '@shared/types'
import { isMarkdown } from '@shared/pathUtils'
import { isStaleError } from '@shared/errors'
import { backlinksFor } from '@shared/wikiResolve'
import { host, on } from '../shared/rpc'
import { showToast, useIndexStore } from '../shared/stores'
import { Toast } from '../shared/components/Toast'

export function BacklinksApp({ initialNote }: { initialNote: string | null }): React.JSX.Element {
  const [notePath, setNotePath] = useState<string | null>(
    initialNote && isMarkdown(initialNote) ? initialNote : null
  )
  const notes = useIndexStore((s) => s.notes)
  const [mentions, setMentions] = useState<Mention[]>([])
  const [backlinksCollapsed, setBacklinksCollapsed] = useState(false)
  const [unlinkedCollapsed, setUnlinkedCollapsed] = useState(false)

  useEffect(
    () =>
      on('activeNoteChanged', (path) => {
        if (path !== null && isMarkdown(path)) setNotePath(path)
      }),
    []
  )

  const backlinks = useMemo(
    () => (notePath ? backlinksFor(notePath, notes) : []),
    [notePath, notes]
  )

  // Unlinked mentions: plain-text occurrences of this note's title/aliases
  useEffect(() => {
    if (!notePath) {
      setMentions([])
      return
    }
    const meta = notes.get(notePath)
    if (!meta) return
    const t = setTimeout(() => {
      void host.findMentions([meta.title, ...meta.aliases], notePath).then((found) => {
        // Drop mentions from notes that already link here
        const linking = new Set(backlinks.map((b) => b.path.toLowerCase()))
        setMentions(found.filter((m) => !linking.has(m.path.toLowerCase())))
      })
    }, 400)
    return () => clearTimeout(t)
  }, [notePath, notes, backlinks])

  const linkIt = async (mention: Mention): Promise<void> => {
    const actual = mention.text.substr(mention.col, mention.length)
    const meta = notePath ? notes.get(notePath) : undefined
    const title = meta?.title ?? actual
    const replacement =
      actual.toLowerCase() === title.toLowerCase() ? `[[${actual}]]` : `[[${title}|${actual}]]`
    const newLine =
      mention.text.slice(0, mention.col) +
      replacement +
      mention.text.slice(mention.col + mention.length)
    try {
      await host.replaceLine(mention.path, mention.line, mention.text, newLine)
    } catch (err) {
      showToast(isStaleError(err) ? 'That note changed — refreshed.' : String(err))
    }
  }

  if (!notePath) {
    return <div className="panel-empty">Open a note to see its backlinks</div>
  }

  return (
    <div className="side-panel">
      <div className="side-panel-body">
        <div className="right-section">
          <div
            className="right-section-title section-header"
            onClick={() => setBacklinksCollapsed((c) => !c)}
          >
            {backlinksCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            <span>Backlinks ({backlinks.length})</span>
          </div>
          {!backlinksCollapsed &&
            (backlinks.length === 0 ? (
              <div className="panel-empty">No notes link here yet</div>
            ) : (
              backlinks.map((b, i) => (
                <div
                  key={`${b.path}-${b.line}-${i}`}
                  className="backlink-row"
                  onClick={() => void host.openNote(b.path, b.line)}
                >
                  <div className="backlink-title">{b.title}</div>
                  <div className="backlink-context">{b.context}</div>
                </div>
              ))
            ))}
        </div>

        <div className="right-section">
          <div
            className="right-section-title section-header"
            onClick={() => setUnlinkedCollapsed((c) => !c)}
          >
            {unlinkedCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            <span>Unlinked mentions ({mentions.length})</span>
          </div>
          {!unlinkedCollapsed &&
            (mentions.length === 0 ? (
              <div className="panel-empty">None found</div>
            ) : (
              mentions.map((m, i) => (
                <div key={`${m.path}-${m.line}-${m.col}-${i}`} className="backlink-row">
                  <div
                    className="backlink-title"
                    onClick={() => void host.openNote(m.path, m.line)}
                  >
                    {m.path.replace(/\.md$/i, '')}
                  </div>
                  <div className="backlink-context">{m.text}</div>
                  <button
                    className="link-it-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      void linkIt(m)
                    }}
                  >
                    Link
                  </button>
                </div>
              ))
            ))}
        </div>
      </div>
      <Toast />
    </div>
  )
}
