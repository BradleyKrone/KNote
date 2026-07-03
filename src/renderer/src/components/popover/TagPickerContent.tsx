import { useEffect, useMemo, useRef, useState } from 'react'
import { useIndexStore, tagCounts } from '@/stores/indexStore'

const VALID_TAG = /^[A-Za-z0-9_][A-Za-z0-9_/-]*$/

interface Props {
  onSelect: (tag: string) => void
}

export function TagPickerContent({ onSelect }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const tags = useMemo(() => {
    const notes = useIndexStore.getState().notes
    const all = [...tagCounts(notes).entries()].sort((a, b) => b[1] - a[1])
    const q = query.trim().toLowerCase()
    return q ? all.filter(([tag]) => tag.toLowerCase().includes(q)) : all
  }, [query])

  const cleanQuery = query.trim().replace(/^#/, '')
  const canCreate =
    cleanQuery.length > 0 &&
    VALID_TAG.test(cleanQuery) &&
    !tags.some(([tag]) => tag.toLowerCase() === cleanQuery.toLowerCase())

  return (
    <div className="picker">
      <input
        ref={inputRef}
        className="picker-input"
        placeholder="Search or create a tag…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (tags[0]) onSelect(tags[0][0])
            else if (canCreate) onSelect(cleanQuery)
          }
        }}
      />
      <div className="picker-list">
        {tags.map(([tag, count]) => (
          <div
            key={tag}
            className="picker-row"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(tag)}
          >
            <span className="picker-row-label">#{tag}</span>
            <span className="picker-row-detail">{count}</span>
          </div>
        ))}
        {canCreate && (
          <div
            className="picker-row"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(cleanQuery)}
          >
            <span className="picker-row-label">Create #{cleanQuery}</span>
          </div>
        )}
        {tags.length === 0 && !canCreate && <div className="picker-empty">No tags</div>}
      </div>
    </div>
  )
}
