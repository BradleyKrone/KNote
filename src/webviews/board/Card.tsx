import { useRef, useState } from 'react'
import dayjs from 'dayjs'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Archive, CalendarDays, Hourglass, Link2, Pencil, X } from 'lucide-react'
import { withoutAnchor } from '@shared/blockAnchor'
import { confirm } from '../shared/stores'
import { archiveCard, copyCardLink, deleteCard, openSource, updateCardText } from './boardActions'
import { dueState, followUpState, type BoardCard } from './boardSelectors'
import { TaskMetaToolbar, blurTargetIsPicker } from '../shared/components/TaskMetaToolbar'
import { formatTimeUntil } from '../shared/dates'
import { PRIORITY_LABELS } from '../shared/taskMeta'

export function cardId(card: BoardCard): string {
  return `${card.path} ${card.line} ${card.rawLine}`
}

/**
 * The due date, coloured by how close it is: red once overdue, yellow on the
 * day, green inside the next week, plain otherwise. `today` is read at render
 * time, so a board left open past midnight recolours on its next update.
 */
function DueChip({ card }: { card: BoardCard }): React.JSX.Element | null {
  if (!card.due) return null
  const today = dayjs().format('YYYY-MM-DD')
  return (
    <span
      className={`board-card-due due-${dueState(card, today)}`}
      title={`Due ${card.due} — ${formatTimeUntil(card.due, today)}`}
    >
      <CalendarDays size={11} /> {card.due}
    </span>
  )
}

/**
 * The follow-up date for a card sitting in a require-reason column (Waiting),
 * coloured on the same scale as the due chip. The hover gives the distance in
 * words plus the reason the card is parked. Only rendered while the card is in
 * that column — moving out deletes the reason line, date and all.
 */
function WaitingChip({ card }: { card: BoardCard }): React.JSX.Element | null {
  const followUp = card.waitingFollowUp
  if (!followUp) return null
  const today = dayjs().format('YYYY-MM-DD')
  const when = `Follow up ${followUp} — ${formatTimeUntil(followUp, today)}`
  return (
    <span
      className={`board-card-waiting follow-${followUpState(card, today)}`}
      title={card.waitingReason ? `${when}\n${card.waitingReason}` : when}
    >
      <Hourglass size={11} /> {followUp}
    </span>
  )
}

/** Static clone rendered in the DragOverlay so it floats above column scroll clipping. */
export function CardPreview({ card }: { card: BoardCard }): React.JSX.Element {
  return (
    <div className="board-card dragging board-card-overlay">
      <div className="board-card-text">
        {card.priority > 0 && (
          <span className={`prio prio-${card.priority}`}>{PRIORITY_LABELS[card.priority]}</span>
        )}
        {card.displayText}
      </div>
      <div className="board-card-meta">
        <span className="board-card-note" title={card.path}>
          {card.noteTitle}
        </span>
        <DueChip card={card} />
        <WaitingChip card={card} />
        {card.tags.map((t) => (
          <span key={t} className="board-card-tag">
            #{t}
          </span>
        ))}
      </div>
    </div>
  )
}

export function Card({
  card,
  showNote
}: {
  card: BoardCard
  showNote: boolean
}): React.JSX.Element {
  const id = cardId(card)
  const drag = useDraggable({ id, data: { card } })
  // Cards are also drop targets so same-note reordering can insert before them
  const drop = useDroppable({ id: `over:${id}`, data: { card }, disabled: drag.isDragging })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(withoutAnchor(card.text))
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const startEdit = (): void => {
    // Without the `^anchor` — it's link plumbing, not task text, and tidying it
    // away here would break every link pointing at this task. updateCardText
    // puts it back.
    setDraft(withoutAnchor(card.text))
    setEditing(true)
  }

  const submitEdit = (): void => {
    setEditing(false)
    void updateCardText(card, draft)
  }

  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el)
        drop.setNodeRef(el)
      }}
      className={['board-card', drag.isDragging ? 'dragging' : '', drop.isOver ? 'drop-before' : '']
        .filter(Boolean)
        .join(' ')}
      {...(editing ? {} : { ...drag.listeners, ...drag.attributes })}
    >
      {editing ? (
        <div className="board-card-edit" onPointerDown={(e) => e.stopPropagation()}>
          <TaskMetaToolbar value={draft} onChange={setDraft} textareaRef={textareaRef} />
          <textarea
            ref={textareaRef}
            className="board-add-input"
            autoFocus
            rows={3}
            value={draft}
            placeholder="Task text — add #tags, 📅 2026-07-15, !! priority…"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => {
              if (!blurTargetIsPicker(e)) submitEdit()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submitEdit()
              }
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        </div>
      ) : (
        <>
          <div className="board-card-text">
            {card.priority > 0 && (
              <span className={`prio prio-${card.priority}`}>{PRIORITY_LABELS[card.priority]}</span>
            )}
            {card.displayText}
          </div>
          <div className="board-card-meta">
            {showNote && (
              <span
                className="board-card-note"
                title={card.path}
                onClick={(e) => {
                  e.stopPropagation()
                  openSource(card)
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {card.noteTitle}
              </span>
            )}
            <DueChip card={card} />
            <WaitingChip card={card} />
            {card.tags.map((t) => (
              <span key={t} className="board-card-tag">
                #{t}
              </span>
            ))}
          </div>
          <div className="board-card-actions">
            <button
              className="board-card-action"
              title="Copy link to task — paste it in any note to link straight back here"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                void copyCardLink(card)
              }}
            >
              <Link2 size={12} />
            </button>
            <button
              className="board-card-action"
              title="Edit task (add tags, dates…)"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                startEdit()
              }}
            >
              <Pencil size={12} />
            </button>
            <button
              className="board-card-action"
              title="Archive task (strikes it through and removes it from the board)"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                void confirm(
                  'Archive this task? It will be struck through and removed from the board.'
                ).then((ok) => {
                  if (ok) void archiveCard(card)
                })
              }}
            >
              <Archive size={12} />
            </button>
            <button
              className="board-card-action danger"
              title="Delete task line"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                void confirm('Delete this task line from its note?', { danger: true }).then(
                  (ok) => {
                    if (ok) void deleteCard(card)
                  }
                )
              }}
            >
              <X size={12} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
