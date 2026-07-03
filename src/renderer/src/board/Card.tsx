import { useRef, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Archive, CalendarDays, Pencil, X } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useUiStore } from '@/stores/uiStore'
import { archiveCard, deleteCard, updateCardText } from './boardActions'
import type { BoardCard } from './boardSelectors'
import { TaskMetaToolbar, blurTargetIsPicker } from './TaskMetaToolbar'

export function cardId(card: BoardCard): string {
  return `${card.path} ${card.line} ${card.rawLine}`
}

export function Card({ card, showNote }: { card: BoardCard; showNote: boolean }): React.JSX.Element {
  const id = cardId(card)
  const drag = useDraggable({ id, data: { card } })
  // Cards are also drop targets so same-note reordering can insert before them
  const drop = useDroppable({ id: `over:${id}`, data: { card } })
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
      className={[
        'board-card',
        drag.isDragging ? 'dragging' : '',
        drop.isOver ? 'drop-before' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        drag.transform
          ? { transform: `translate(${drag.transform.x}px, ${drag.transform.y}px)`, zIndex: 50 }
          : undefined
      }
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
              <span className={`prio prio-${card.priority}`}>{'!'.repeat(card.priority)}</span>
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
                void archiveCard(card)
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
                if (window.confirm('Delete this task line from its note?')) void deleteCard(card)
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
