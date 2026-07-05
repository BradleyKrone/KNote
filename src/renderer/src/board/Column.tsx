import { useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { Archive, Plus } from 'lucide-react'
import type { BoardColumn } from '@shared/types'
import { confirm } from '@/stores/confirmStore'
import { addCard, archiveCards } from './boardActions'
import type { BoardCard, BoardScope } from './boardSelectors'
import { Card } from './Card'
import { TaskMetaToolbar, blurTargetIsPicker } from './TaskMetaToolbar'
import { titleOf } from '@shared/pathUtils'

interface Props {
  column: BoardColumn
  cards: BoardCard[]
  scope: BoardScope
  groupByNote: boolean
}

export function Column({ column, cards, scope, groupByNote }: Props): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${column.char}`,
    data: { column }
  })
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const submit = (): void => {
    const value = text.trim()
    setAdding(false)
    setText('')
    if (value) void addCard(scope, column.char, value)
  }

  const groups: Array<{ note: string | null; cards: BoardCard[] }> = []
  if (groupByNote) {
    const byNote = new Map<string, BoardCard[]>()
    for (const c of cards) {
      const list = byNote.get(c.path) ?? []
      list.push(c)
      byNote.set(c.path, list)
    }
    for (const [note, list] of byNote) groups.push({ note, cards: list })
  } else {
    groups.push({ note: null, cards })
  }

  return (
    <div ref={setNodeRef} className={`board-column${isOver ? ' drag-over' : ''}`}>
      <div className="board-column-header">
        <span className="board-column-name">{column.name}</span>
        <span className="board-column-count">{cards.length}</span>
        {column.char === 'x' && cards.length > 0 && (
          <button
            className="board-column-archive-all"
            title={`Archive all ${cards.length} task${cards.length === 1 ? '' : 's'} in ${column.name}`}
            onClick={() => {
              void confirm(
                `Archive all ${cards.length} task${cards.length === 1 ? '' : 's'} in "${column.name}"? They will be struck through and removed from the board.`
              ).then((ok) => {
                if (ok) void archiveCards(cards)
              })
            }}
          >
            <Archive size={12} /> Archive all
          </button>
        )}
      </div>
      <div className="board-column-body">
        {groups.map((g) => (
          <div key={g.note ?? '_all'}>
            {g.note !== null && <div className="board-group-label">{titleOf(g.note)}</div>}
            {g.cards.map((card) => (
              <Card key={`${card.path}:${card.line}`} card={card} showNote={scope.kind !== 'note' && !groupByNote} />
            ))}
          </div>
        ))}
        {adding ? (
          <div className="board-card-edit">
            <TaskMetaToolbar value={text} onChange={setText} textareaRef={textareaRef} />
            <textarea
              ref={textareaRef}
              className="board-add-input"
              autoFocus
              rows={2}
              placeholder="Task text…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={(e) => {
                if (!blurTargetIsPicker(e)) submit()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
                if (e.key === 'Escape') {
                  setAdding(false)
                  setText('')
                }
              }}
            />
          </div>
        ) : (
          <button className="board-add-btn" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add card
          </button>
        )}
      </div>
    </div>
  )
}
