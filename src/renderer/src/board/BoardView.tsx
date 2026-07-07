import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
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
import { cardId, CardPreview } from './Card'
import { promptReason } from '@/stores/reasonPromptStore'
import { reasonLineForTask } from '@shared/parser/patterns'

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

  const [activeCard, setActiveCard] = useState<BoardCard | null>(null)
  const [overColumnChar, setOverColumnChar] = useState<string | null>(null)
  // While a column-change commit is in flight (disk write + reindex round trip),
  // keep showing the drag preview in place instead of snapping back to the old
  // column and then jumping to the new one once the real data catches up.
  // Identified by path+line (stable across the in-place status-char rewrite),
  // not cardId (which embeds rawLine and so changes the moment the char does).
  const pendingMoveRef = useRef<{ path: string; line: number; targetChar: string } | null>(null)

  useEffect(() => {
    const pending = pendingMoveRef.current
    if (!pending) return
    const moved = cards.find((c) => c.path === pending.path && c.line === pending.line)
    if (moved && columnForChar(columns, moved.statusChar) === columnForChar(columns, pending.targetChar)) {
      pendingMoveRef.current = null
      setActiveCard(null)
      setOverColumnChar(null)
    }
  }, [cards, columns])

  const displayByColumn = useMemo(() => {
    if (!activeCard || overColumnChar === null || overColumnChar === activeCard.statusChar) {
      return byColumn
    }
    const draggedId = cardId(activeCard)
    return columns.map((col, i) => {
      if (col.char === activeCard.statusChar) {
        return byColumn[i].filter((c) => cardId(c) !== draggedId)
      }
      if (col.char === overColumnChar) {
        return byColumn[i].some((c) => cardId(c) === draggedId)
          ? byColumn[i]
          : [...byColumn[i], activeCard]
      }
      return byColumn[i]
    })
  }, [byColumn, columns, activeCard, overColumnChar])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const targetColumnChar = (over: DragEndEvent['over']): string | null => {
    if (!over) return null
    const overId = String(over.id)
    if (overId.startsWith('col:')) return overId.slice(4)
    const overCard = over.data.current?.card as BoardCard | undefined
    return overCard ? overCard.statusChar : null
  }

  const onDragStart = (event: DragStartEvent): void => {
    pendingMoveRef.current = null
    const card = event.active.data.current?.card as BoardCard | undefined
    setActiveCard(card ?? null)
    setOverColumnChar(card?.statusChar ?? null)
  }

  const onDragOver = (event: DragOverEvent): void => {
    const targetChar = targetColumnChar(event.over)
    if (targetChar) setOverColumnChar(targetChar)
  }

  /** Column change committed: keep the preview until `cards` confirms the move. */
  const commitColumnChange = (card: BoardCard, targetChar: string, appendText = ''): void => {
    const pending = { path: card.path, line: card.line, targetChar }
    pendingMoveRef.current = pending
    void setCardStatus(card, targetChar, appendText).finally(() => {
      // Safety net: if the store never reflects the move (e.g. a stale-write
      // conflict that silently no-ops), don't leave the preview stuck forever.
      setTimeout(() => {
        if (pendingMoveRef.current === pending) clearPreview()
      }, 2000)
    })
  }

  /**
   * Gate a column change on a reason + date when the target column requires
   * one (e.g. Waiting) — cancelling snaps the drag preview back instead of
   * committing a bare status-char change.
   */
  const attemptColumnChange = (card: BoardCard, targetChar: string): void => {
    const targetColumn = columns.find((c) => c.char === targetChar)
    if (!targetColumn?.requireReason) {
      commitColumnChange(card, targetChar)
      return
    }
    void promptReason(targetColumn.name).then((result) => {
      if (!result) {
        clearPreview()
        return
      }
      commitColumnChange(
        card,
        targetChar,
        reasonLineForTask(card.rawLine, targetColumn.name, result.reason, result.date)
      )
    })
  }

  const clearPreview = (): void => {
    pendingMoveRef.current = null
    setActiveCard(null)
    setOverColumnChar(null)
  }

  const onDragEnd = (event: DragEndEvent): void => {
    const card = event.active.data.current?.card as BoardCard | undefined
    if (!card || !event.over) {
      clearPreview()
      return
    }
    const overId = String(event.over.id)

    if (overId.startsWith('col:')) {
      const targetChar = overId.slice(4)
      if (targetChar !== card.statusChar) attemptColumnChange(card, targetChar)
      else clearPreview()
      return
    }
    // Dropped onto another card: same column = reorder, different column = move
    const overCard = event.over.data.current?.card as BoardCard | undefined
    if (!overCard) {
      clearPreview()
      return
    }
    const sameColumn = columnForChar(columns, overCard.statusChar) === columnForChar(columns, card.statusChar)
    if (!sameColumn) {
      attemptColumnChange(card, overCard.statusChar)
    } else if (card.path === overCard.path && card.line !== overCard.line) {
      void reorderCard(card, overCard)
      clearPreview()
    } else {
      if (card.path !== overCard.path) {
        useUiStore.getState().showToast('Cards keep note order — reorder works within one note')
      }
      clearPreview()
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
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
        <div className="board-columns">
          {columns.map((col, i) => (
            <Column
              key={col.char + col.name}
              column={col}
              cards={displayByColumn[i]}
              scope={scope}
              groupByNote={groupByNote}
            />
          ))}
        </div>
        <DragOverlay>{activeCard ? <CardPreview card={activeCard} /> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}
