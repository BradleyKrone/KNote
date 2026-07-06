import { useEffect, useMemo, useRef, useState } from 'react'
import { useIndexStore, tagCounts } from '@/stores/indexStore'

const VALID_TAG = /^[A-Za-z0-9_][A-Za-z0-9_/-]*$/

interface Props {
  onSelect: (tag: string) => void
}

export function TagPickerContent({ onSelect }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
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

  // Combined, ordered list of everything Tab can cycle through and Enter can pick.
  const options = useMemo(
    () => [...tags.map(([tag]) => tag), ...(canCreate ? [cleanQuery] : [])],
    [tags, canCreate, cleanQuery]
  )

  const clampedIndex = options.length === 0 ? -1 : Math.min(activeIndex, options.length - 1)

  return (
    <div className="picker">
      <input
        ref={inputRef}
        className="picker-input"
        placeholder="Search or create a tag…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault()
            if (options.length === 0) return
            setActiveIndex((i) => {
              const current = Math.min(i, options.length - 1)
              return e.shiftKey
                ? (current - 1 + options.length) % options.length
                : (current + 1) % options.length
            })
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (clampedIndex >= 0) onSelect(options[clampedIndex])
          }
        }}
      />
      <div className="picker-list">
        {tags.map(([tag, count], i) => (
          <div
            key={tag}
            className={`picker-row${i === clampedIndex ? ' active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(tag)}
          >
            <span className="picker-row-label">#{tag}</span>
            <span className="picker-row-detail">{count}</span>
          </div>
        ))}
        {canCreate && (
          <div
            className={`picker-row${tags.length === clampedIndex ? ' active' : ''}`}
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
