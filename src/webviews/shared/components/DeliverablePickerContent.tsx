import { useEffect, useMemo, useRef, useState } from 'react'
import { liveDeliverables } from '@shared/deliverables'
import { useIndexStore } from '../stores'

interface Props {
  onSelect: (tag: string) => void
}

/** Picks a deliverable to join with `@deliverable(project/name)` — every scheduled, open deliverable. */
export function DeliverablePickerContent({ onSelect }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const options = useMemo(() => {
    const notes = useIndexStore.getState().notes
    const all = liveDeliverables(notes)
    const q = query.trim().toLowerCase()
    return q
      ? all.filter((d) => d.label.toLowerCase().includes(q) || d.project.toLowerCase().includes(q))
      : all
  }, [query])

  const clampedIndex = options.length === 0 ? -1 : Math.min(activeIndex, options.length - 1)

  return (
    <div className="picker">
      <input
        ref={inputRef}
        className="picker-input"
        placeholder="Search a deliverable…"
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
            if (clampedIndex >= 0) onSelect(options[clampedIndex].tag)
          }
        }}
      />
      <div className="picker-list">
        {options.map((d, i) => (
          <div
            key={d.tag}
            className={`picker-row${i === clampedIndex ? ' active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(d.tag)}
          >
            <span className="picker-row-label">{d.label}</span>
            <span className="picker-row-detail">{d.project}</span>
          </div>
        ))}
        {options.length === 0 && <div className="picker-empty">No open deliverables</div>}
      </div>
    </div>
  )
}
