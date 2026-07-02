import { useMemo, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { X } from 'lucide-react'
import { useIndexStore } from '@/stores/indexStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import {
  boardTags,
  collectCards,
  columnForChar,
  groupByColumn,
  scopeLabel,
  type BoardCard
} from './boardSelectors'
import { reorderCard, setCardStatus } from './boardActions'
import { Column } from './Column'

export function BoardView(): React.JSX.Element {
  const notes = useIndexStore((s) => s.notes)
  const columns = useSettingsStore((s) => s.vaultConfig.columns)
  const scope = useUiStore((s) => s.boardScope)
  const setBoardOpen = useUiStore((s) => s.setBoardOpen)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [textFilter, setTextFilter] = useState('')
  const [groupByNote, setGroupByNote] = useState(false)

  const cards = useMemo(
    () => collectCards(notes, scope, { tag: tagFilter, text: textFilter }),
    [notes, scope, tagFilter, textFilter]
  )
  const byColumn = useMemo(() => groupByColumn(cards, columns), [cards, columns])
  const tags = useMemo(() => boardTags(notes, scope), [notes, scope])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const onDragEnd = (event: DragEndEvent): void => {
    const card = event.active.data.current?.card as BoardCard | undefined
    if (!card || !event.over) return
    const overId = String(event.over.id)

    if (overId.startsWith('col:')) {
      const targetChar = overId.slice(4)
      if (targetChar !== card.statusChar) void setCardStatus(card, targetChar)
      return
    }
    // Dropped onto another card: same column = reorder, different column = move
    const overCard = event.over.data.current?.card as BoardCard | undefined
    if (!overCard) return
    const sameColumn = columnForChar(columns, overCard.statusChar) === columnForChar(columns, card.statusChar)
    if (!sameColumn) {
      void setCardStatus(card, overCard.statusChar)
    } else if (card.path === overCard.path && card.line !== overCard.line) {
      void reorderCard(card, overCard)
    } else if (card.path !== overCard.path) {
      useUiStore.getState().showToast('Cards keep note order — reorder works within one note')
    }
  }

  return (
    <div className="board-view">
      <div className="board-header">
        <div className="board-title">
          Board <span className="board-scope">{scopeLabel(scope)}</span>
        </div>
        <div className="board-controls">
          <input
            className="panel-input small board-filter"
            placeholder="Filter tasks…"
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
          <label className="board-group-toggle">
            <input
              type="checkbox"
              checked={groupByNote}
              onChange={(e) => setGroupByNote(e.target.checked)}
            />
            Group by note
          </label>
          <button className="icon-btn" title="Close board" onClick={() => setBoardOpen(false)}>
            <X size={16} />
          </button>
        </div>
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="board-columns">
          {columns.map((col, i) => (
            <Column key={col.char + col.name} column={col} cards={byColumn[i]} scope={scope} groupByNote={groupByNote} />
          ))}
        </div>
      </DndContext>
    </div>
  )
}
