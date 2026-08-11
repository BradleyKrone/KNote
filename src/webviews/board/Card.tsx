import { useRef, useState } from 'react'
import dayjs from 'dayjs'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Archive, CalendarDays, Hourglass, Link2, Package, Pencil, X } from 'lucide-react'
import { withoutAnchor } from '@shared/blockAnchor'
import { parseDeliverableTag } from '@shared/parser/patterns'
import { isTaskDone } from '@shared/deliverables'
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

/**
 * Which deliverable(s) this card belongs to — a distinct chip, not a `#tag`
 * pill, since deliverable membership isn't a content tag (see
 * `deliverableMembershipOf`). Labelled with just the deliverable's own name;
 * the project it belongs to is implied by context (which board/scope you're
 * looking at). Skips the tag this card itself defines — that's covered by
 * `DeliverableBadge` instead, so a deliverable's own card doesn't show a
 * redundant outlined chip alongside its filled one. A chip for a deliverable
 * whose window has closed with work still open (`overdueDeliverables`) reads
 * red, the same overdue treatment `DueChip` gives a task's own blown-past
 * date — so a task with no `@due()` of its own still shows late once its
 * deliverable is. Never on a card that's itself done, though: this task's
 * own contribution is finished, so it shouldn't keep reading as late just
 * because *other* work on the same deliverable is still open — the same
 * carve-out `dueState`/`followUpState` give a done card's own date.
 */
function DeliverableChips({ card }: { card: BoardCard }): React.JSX.Element | null {
  const joined = card.deliverables.filter((tag) => tag !== card.definesDeliverable)
  if (joined.length === 0) return null
  const done = isTaskDone(card)
  return (
    <>
      {joined.map((tag) => {
        const parsed = parseDeliverableTag(tag)
        const overdue = !done && card.overdueDeliverables.includes(tag)
        return (
          <span
            key={tag}
            className={`board-card-deliverable${overdue ? ' overdue' : ''}`}
            title={overdue ? `${tag} — deliverable overdue` : tag}
          >
            <Package size={11} /> {parsed?.deliverable ?? tag}
          </span>
        )
      })}
    </>
  )
}

/**
 * Marks a card as *the* card that defines a deliverable, filled (not
 * outlined) so it reads as primary rather than a reference — the same
 * filled-vs-outline convention the Live Preview editor uses for a defining
 * line vs a joining one (`.cm-knote-deliverable-ref`/`-join`). Shows member-task
 * completion once the deliverable has any members; a brand-new deliverable
 * with nothing joined yet just reads "Deliverable". Reads red, same as an
 * overdue `DueChip`, once its window has closed with work still open.
 */
function DeliverableBadge({ card }: { card: BoardCard }): React.JSX.Element | null {
  if (!card.definesDeliverable) return null
  const progress = card.progress
  const overdue = card.overdueDeliverables.includes(card.definesDeliverable)
  return (
    <div className={`board-card-deliverable-badge${overdue ? ' overdue' : ''}`}>
      <Package size={11} />
      Deliverable
      {progress && progress.total > 0 ? ` · ${progress.done}/${progress.total} done` : ''}
    </div>
  )
}

/** Static clone rendered in the DragOverlay so it floats above column scroll clipping. */
export function CardPreview({ card }: { card: BoardCard }): React.JSX.Element {
  return (
    <div
      className={[
        'board-card',
        'dragging',
        'board-card-overlay',
        card.definesDeliverable ? 'is-deliverable' : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <DeliverableBadge card={card} />
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
        <DeliverableChips card={card} />
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
      className={[
        'board-card',
        drag.isDragging ? 'dragging' : '',
        drop.isOver ? 'drop-before' : '',
        card.definesDeliverable ? 'is-deliverable' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      title="Double-click to open this task in its note"
      {...(editing
        ? {}
        : {
            ...drag.listeners,
            ...drag.attributes,
            // The card body is the open-source affordance. The note chip below
            // does the same on a single click, but it's hidden whenever the
            // note name is already obvious (grouped board, per-note board) —
            // this is what's left, so it can't be gated on `showNote`.
            onDoubleClick: () => {
              // Double-clicking text selects a word; drop it so the card
              // doesn't keep a stray highlight once the editor takes focus.
              window.getSelection()?.removeAllRanges()
              openSource(card)
            }
          })}
    >
      {!editing && <DeliverableBadge card={card} />}
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
                onDoubleClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {card.noteTitle}
              </span>
            )}
            <DueChip card={card} />
            <WaitingChip card={card} />
            <DeliverableChips card={card} />
            {card.tags.map((t) => (
              <span key={t} className="board-card-tag">
                #{t}
              </span>
            ))}
          </div>
          <div className="board-card-actions" onDoubleClick={(e) => e.stopPropagation()}>
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
