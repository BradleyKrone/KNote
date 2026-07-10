import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Mention } from '@shared/types'
import { samePath } from '@shared/pathUtils'
import { isStaleError } from '@shared/errors'
import { backlinksFor, useIndexStore } from '@/stores/indexStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useUiStore } from '@/stores/uiStore'

export function BacklinksPanel(): React.JSX.Element {
  const notePath = useWorkspaceStore((s) => s.note?.path ?? null)
  const notes = useIndexStore((s) => s.notes)
  const [mentions, setMentions] = useState<Mention[]>([])
  const backlinksCollapsed = useUiStore((s) => s.backlinksCollapsed)
  const toggleBacklinks = useUiStore((s) => s.toggleBacklinks)
  const unlinkedCollapsed = useUiStore((s) => s.unlinkedMentionsCollapsed)
  const toggleUnlinkedMentions = useUiStore((s) => s.toggleUnlinkedMentions)

  const backlinks = useMemo(
    () => (notePath ? backlinksFor(notePath) : []),
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
      void window.knote
        .findMentions([meta.title, ...meta.aliases], notePath)
        .then((found) => {
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
      await window.knote.replaceLine(mention.path, mention.line, mention.text, newLine)
    } catch (err) {
      alert(isStaleError(err) ? 'That note changed — refreshed.' : String(err))
    }
  }

  if (!notePath) return <div className="panel-empty">Open a note to see its backlinks</div>

  return (
    <>
      <div className="right-section">
        <div className="right-section-title section-header" onClick={toggleBacklinks}>
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
                onClick={() => void useWorkspaceStore.getState().openFile(b.path, b.line)}
              >
                <div className="backlink-title">{b.title}</div>
                <div className="backlink-context">{b.context}</div>
              </div>
            ))
          ))}
      </div>

      <div className="right-section">
        <div className="right-section-title section-header" onClick={toggleUnlinkedMentions}>
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
                  onClick={() => void useWorkspaceStore.getState().openFile(m.path, m.line)}
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
    </>
  )
}

export function useOpenNoteMeta(): ReturnType<typeof pick> {
  const notePath = useWorkspaceStore((s) => s.note?.path ?? null)
  const notes = useIndexStore((s) => s.notes)
  return pick(notePath, notes)
}

function pick(
  notePath: string | null,
  notes: Map<string, import('@shared/types').NoteMeta>
): import('@shared/types').NoteMeta | null {
  if (!notePath) return null
  for (const [p, meta] of notes) {
    if (samePath(p, notePath)) return meta
  }
  return null
}
