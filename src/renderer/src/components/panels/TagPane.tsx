import { useMemo } from 'react'
import { CircleOff, Hash } from 'lucide-react'
import { tagCounts, untaggedCount, useIndexStore } from '@/stores/indexStore'
import { useUiStore } from '@/stores/uiStore'

export function TagPane(): React.JSX.Element {
  const notes = useIndexStore((s) => s.notes)
  const searchFor = useUiStore((s) => s.searchFor)

  const tags = useMemo(() => {
    return [...tagCounts(notes).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [notes])
  const untagged = useMemo(() => untaggedCount(notes), [notes])

  return (
    <div className="side-panel">
      <div className="side-panel-body">
        {tags.length === 0 && <div className="panel-empty">No tags in this vault</div>}
        {notes.size > 0 && (
          <div className="tag-row tag-row-untagged" onClick={() => searchFor('tag:none')}>
            <CircleOff size={13} className="tag-row-icon" />
            <span className="tag-row-name">(no tags)</span>
            <span className="tag-row-count">{untagged}</span>
          </div>
        )}
        {tags.map(([tag, count]) => (
          <div key={tag} className="tag-row" onClick={() => searchFor(`tag:#${tag}`)}>
            <Hash size={13} className="tag-row-icon" />
            <span className="tag-row-name">{tag}</span>
            <span className="tag-row-count">{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
