// The timeline view: dated tasks and 🏁 milestones from across the vault
// laid out chronologically.

import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { CheckCircle2, Circle, FileText, Flag, X } from 'lucide-react'
import { useIndexStore } from '@/stores/indexStore'
import { useUiStore } from '@/stores/uiStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import {
  collectTimelineItems,
  formatTimeUntil,
  timelineTags,
  type TimelineItem
} from './timelineSelectors'

export function TimelineView(): React.JSX.Element {
  const notes = useIndexStore((s) => s.notes)
  const setTimelineOpen = useUiStore((s) => s.setTimelineOpen)
  const todayRef = useRef<HTMLDivElement>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [textFilter, setTextFilter] = useState('')

  const today = dayjs().format('YYYY-MM-DD')

  const tags = useMemo(() => timelineTags(notes), [notes])

  const groups = useMemo(() => {
    const byDate = collectTimelineItems(notes, { tag: tagFilter, text: textFilter })
    // Always show today, even with nothing due
    if (!byDate.has(today)) byDate.set(today, [])
    return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [notes, today, tagFilter, textFilter])

  const hasItems = groups.some(([, items]) => items.length > 0)

  useEffect(() => {
    todayRef.current?.scrollIntoView({ block: 'center' })
  }, [])

  const open = (item: TimelineItem): void => {
    setTimelineOpen(false)
    void useWorkspaceStore
      .getState()
      .openFile(item.path, item.kind !== 'note' ? item.line : undefined)
  }

  return (
    <div className="timeline-view">
      <div className="board-header">
        <div className="board-title">
          Timeline
          <span className="board-scope">
            {today} · {dayjs().format('dddd')}
          </span>
        </div>
        <div className="board-controls">
          <input
            className="panel-input small board-filter"
            placeholder="Filter timeline…"
            value={textFilter}
            onChange={(e) => setTextFilter(e.target.value)}
          />
          <select
            className="board-tag-select"
            value={tagFilter ?? ''}
            onChange={(e) => setTagFilter(e.target.value || null)}
          >
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            title="Close timeline"
            onClick={() => setTimelineOpen(false)}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-track">
          {!hasItems && (
            <div className="panel-empty timeline-empty">
              Nothing dated yet. Add <code>📅 2026-07-15</code> to a task, a{' '}
              <code>date: 2026-07-15</code> frontmatter property to a note, or{' '}
              <code>🏁 Milestone 📅 2026-07-15</code> anywhere in a note for a standalone timeline
              entry (append <code>!!!</code> for a big important milestone) — and it will appear
              here.
            </div>
          )}
          {groups.map(([date, items]) => {
            const isToday = date === today
            const isPast = date < today
            return (
              <div
                key={date}
                ref={isToday ? todayRef : undefined}
                className={['timeline-group', isToday ? 'today' : '', isPast ? 'past' : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className="timeline-date">
                  <span className="timeline-dot" />
                  <span className="timeline-date-label">
                    {dayjs(date).format('ddd, MMM D YYYY')}
                    {isToday && <span className="timeline-today-badge">TODAY</span>}
                    {isPast && items.some((i) => !i.done) && (
                      <span className="timeline-overdue-badge">overdue</span>
                    )}
                  </span>
                </div>
                <div className="timeline-items">
                  {isToday && items.length === 0 && (
                    <div className="timeline-nothing">Nothing due today</div>
                  )}
                  {items.map((item, i) => (
                    <div
                      key={`${item.path}-${item.line}-${i}`}
                      className={[
                        'timeline-item',
                        item.done ? 'done' : '',
                        item.important ? 'important' : ''
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => open(item)}
                    >
                      <span className="timeline-item-icon">
                        {item.kind === 'note' ? (
                          <FileText size={14} />
                        ) : item.kind === 'milestone' ? (
                          <Flag size={14} />
                        ) : item.done ? (
                          <CheckCircle2 size={14} />
                        ) : (
                          <Circle size={14} />
                        )}
                      </span>
                      <span className="timeline-item-text">{item.text}</span>
                      {item.kind !== 'note' && (
                        <span className="timeline-item-note">{item.noteTitle}</span>
                      )}
                      {!item.done && (
                        <span className={`timeline-item-countdown${isPast ? ' overdue' : ''}`}>
                          {formatTimeUntil(item.date, today)}
                        </span>
                      )}
                      {item.tags.map((t) => (
                        <span key={t} className="board-card-tag">
                          #{t}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
