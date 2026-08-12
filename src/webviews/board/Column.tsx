import { useDroppable } from '@dnd-kit/core'
import { Archive, Plus } from 'lucide-react'
import type { BoardColumn } from '@shared/types'
import { titleOf } from '@shared/pathUtils'
import { confirm } from '../shared/stores'
import { archiveCards } from './boardActions'
import type { BoardCard, BoardScope } from './boardSelectors'
import { Card } from './Card'
import { addTaskNote } from './taskNoteStore'

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
              <Card
                key={`${card.path}:${card.line}`}
                card={card}
                showNote={scope.kind !== 'note' && !groupByNote}
              />
            ))}
          </div>
        ))}
        <button className="board-add-btn" onClick={() => addTaskNote(scope, column)}>
          <Plus size={14} /> Add card
        </button>
      </div>
    </div>
  )
}
