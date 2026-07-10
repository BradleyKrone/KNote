import { useRef, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Archive, CalendarDays, Hourglass, Pencil, X } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useUiStore } from '@/stores/uiStore'
import { confirm } from '@/stores/confirmStore'
import { archiveCard, deleteCard, updateCardText } from './boardActions'
import type { BoardCard } from './boardSelectors'
import { TaskMetaToolbar, blurTargetIsPicker } from './TaskMetaToolbar'
import { PRIORITY_LABELS } from '@/taskMeta'

export function cardId(card: BoardCard): string {
  return `${card.path} ${card.line} ${card.rawLine}`
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
        {card.due && (
          <span className="board-card-due">
            <CalendarDays size={11} /> {card.due}
          </span>
        )}
        {card.waitingSince && (
          <span className="board-card-waiting" title={card.waitingReason ?? undefined}>
            <Hourglass size={11} /> {card.waitingSince}
          </span>
        )}
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
  // Disabled while this card is the one being dragged, so it can't be dropped onto itself
  // once the live column preview inserts it into the column under the pointer.
  const drop = useDroppable({ id: `over:${id}`, data: { card }, disabled: drag.isDragging })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(card.text)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const openSource = (): void => {
    useUiStore.getState().setBoardOpen(false)
    void useWorkspaceStore.getState().openFile(card.path, card.line)
  }

  const startEdit = (): void => {
    setDraft(card.text)
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
                  openSource()
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {card.noteTitle}
              </span>
            )}
            {card.due && (
              <span className="board-card-due">
                <CalendarDays size={11} /> {card.due}
              </span>
            )}
            {card.waitingSince && (
              <span className="board-card-waiting" title={card.waitingReason ?? undefined}>
                <Hourglass size={11} /> {card.waitingSince}
              </span>
            )}
            {card.tags.map((t) => (
              <span key={t} className="board-card-tag">
                #{t}
              </span>
            ))}
          </div>
          <div className="board-card-actions">
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
