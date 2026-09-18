import { useEffect, useMemo, useRef, useState } from 'react'
import { deliverableDefinitions, isDescendantOf, liveDeliverables } from '@shared/deliverables'
import { parseDeliverableTag } from '@shared/parser/patterns'
import { useIndexStore } from '../stores'

interface Props {
  /** The bare tag the task being edited itself defines — the deliverable it names must share this tag's project. */
  ownTag: string
  onSelect: (name: string | null) => void
}

/**
 * Picks another deliverable, in the same project, to make this one a work
 * package of via `@parent(name)`. Only offers top-level deliverables — nesting
 * is capped at one level, so a work package is never itself a valid target —
 * and excludes the deliverable itself and anything already nested under it,
 * so the picker can't be used to author a cycle.
 */
export function ParentDeliverablePickerContent({ ownTag, onSelect }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const ownProject = parseDeliverableTag(ownTag)?.project

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const options = useMemo(() => {
    const notes = useIndexStore.getState().notes
    const definitions = deliverableDefinitions(notes)
    const all = liveDeliverables(notes).filter(
      (d) =>
        d.project === ownProject &&
        d.tag !== ownTag &&
        !definitions.get(d.tag)?.parentTag &&
        !isDescendantOf(definitions, d.tag, ownTag)
    )
    const q = query.trim().toLowerCase()
    return q ? all.filter((d) => d.label.toLowerCase().includes(q)) : all
  }, [query, ownTag, ownProject])

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
            if (clampedIndex >= 0) onSelect(options[clampedIndex].deliverable)
          }
        }}
      />
      <div className="picker-list">
        <div
          className="picker-row"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(null)}
        >
          <span className="picker-row-label">None — top-level deliverable</span>
        </div>
        {options.map((d, i) => (
          <div
            key={d.tag}
            className={`picker-row${i === clampedIndex ? ' active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(d.deliverable)}
          >
            <span className="picker-row-label">{d.label}</span>
          </div>
        ))}
        {options.length === 0 && (
          <div className="picker-empty">No top-level deliverables in this project</div>
        )}
      </div>
    </div>
  )
}
