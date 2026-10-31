// The left pane: the numbered, collapsible project → deliverable → task tree.
// It shares the chart's single scroll container and sticks to the left edge,
// so the two panes can never drift out of vertical sync.
//
// Rows drag up and down to reorder, but only among siblings (same
// `parentKey`), and only while the board is unlocked: moving a row under a different parent would mean rewriting
// its `@deliverable(...)`/`@parent(...)` markers, which a drag shouldn't do.
// The order itself is saved by the parent (`onReorder`), not in any note.

import { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Flag, Package } from 'lucide-react'
import { ROW_HEIGHT, type PlannerRow } from './plannerLayout'

interface Props {
  rows: readonly PlannerRow[]
  /** Row offsets from plannerLayout — shared with the chart so the panes line up. */
  tops: readonly number[]
  height: number
  collapsed: ReadonlySet<string>
  onToggle: (key: string) => void
  onOpen: (row: PlannerRow) => void
  onContextMenu: (e: React.MouseEvent, row: PlannerRow) => void
  /** A sibling dropped onto another — `position` is which side of `target` it lands. */
  onReorder: (dragged: PlannerRow, target: PlannerRow, position: 'before' | 'after') => void
  /** Board-wide drag lock — shared with the bars, so reordering is just as deliberate. */
  locked: boolean
  width: number
}

type DropPosition = 'before' | 'after'

/** Top half of the row → before it, bottom half → after it. */
function dropPositionOf(e: React.DragEvent<HTMLElement>): DropPosition {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function rowLabel(row: PlannerRow): string {
  switch (row.kind) {
    case 'project':
      return row.project.title
    case 'deliverable':
      return row.deliverable.label
    case 'task':
      return row.task.text
    case 'milestone':
      return row.milestone.text
  }
}

function rowIcon(row: PlannerRow): React.JSX.Element | null {
  switch (row.kind) {
    case 'project':
      return <Package size={13} />
    case 'deliverable':
      return null
    case 'task':
      return row.task.done ? <CheckCircle2 size={12} /> : <Circle size={12} />
    case 'milestone':
      return <Flag size={12} />
  }
}

/**
 * Left padding for a row's label, by nesting depth — unbounded now that a
 * deliverable can nest inside another, so this is computed rather than one
 * fixed CSS rule per depth (`depth-1`/`depth-2` used to cover the only two
 * non-project depths that existed).
 */
function indentFor(depth: number): number {
  return depth === 0 ? 0 : 8 + (depth - 1) * 12
}

export function TreePane({
  rows,
  tops,
  height,
  collapsed,
  onToggle,
  onOpen,
  onContextMenu,
  onReorder,
  locked,
  width
}: Props): React.JSX.Element {
  const [dragged, setDragged] = useState<PlannerRow | null>(null)
  const [drop, setDrop] = useState<{ key: string; position: DropPosition } | null>(null)

  const endDrag = (): void => {
    setDragged(null)
    setDrop(null)
  }

  return (
    // Rows are positioned, not stacked: the chart places its bars at the same
    // offsets, and a flow layout here would drift the moment a row's height or
    // margin changed on one side only.
    <div className="planner-tree" style={{ width, height }}>
      {rows.map((row, i) => {
        const collapsible = row.kind === 'project' || row.kind === 'deliverable'
        const isCollapsed = collapsed.has(row.key)
        const canDrop =
          dragged !== null && dragged.key !== row.key && dragged.parentKey === row.parentKey
        return (
          <div
            key={row.key}
            className={[
              'planner-tree-row',
              row.depth === 0 ? 'depth-0' : '',
              (row.kind === 'task' || row.kind === 'milestone') && row.depth > 1 ? 'leaf' : '',
              row.kind === 'task' && row.task.done ? 'done' : '',
              row.kind === 'project' && row.project.complete ? 'project-complete' : '',
              // A rule above every project but the first, so one project's
              // deliverables never read as the next one's.
              row.kind === 'project' && i > 0 ? 'project-start' : '',
              dragged?.key === row.key ? 'dragging' : '',
              drop?.key === row.key ? `drop-${drop.position}` : ''
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ height: ROW_HEIGHT, top: tops[i] }}
            onDoubleClick={() => onOpen(row)}
            onContextMenu={(e) => onContextMenu(e, row)}
            draggable={!locked}
            onDragStart={(e) => {
              if (locked) {
                e.preventDefault()
                return
              }
              e.dataTransfer.effectAllowed = 'move'
              // Firefox won't start a drag without some data set.
              e.dataTransfer.setData('text/plain', row.key)
              setDragged(row)
            }}
            onDragOver={(e) => {
              // Not calling preventDefault is what refuses the drop, so a row
              // under a different parent shows the no-drop cursor.
              if (!canDrop) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const position = dropPositionOf(e)
              if (drop?.key !== row.key || drop.position !== position)
                setDrop({ key: row.key, position })
            }}
            onDragLeave={() => {
              if (drop?.key === row.key) setDrop(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragged && canDrop) onReorder(dragged, row, dropPositionOf(e))
              endDrag()
            }}
            onDragEnd={endDrag}
          >
            <span className="planner-row-number">{row.number}</span>
            {collapsible ? (
              <button
                className="planner-twisty"
                title={isCollapsed ? 'Expand' : 'Collapse'}
                onClick={() => onToggle(row.key)}
              >
                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </button>
            ) : (
              <span className="planner-twisty-spacer" />
            )}
            <span className="planner-row-icon">{rowIcon(row)}</span>
            <span
              className="planner-row-label"
              title={rowLabel(row)}
              style={{ paddingLeft: indentFor(row.depth) }}
            >
              {rowLabel(row)}
            </span>
            {row.kind === 'task' && row.task.foreign && (
              <span className="planner-row-note" title={`Lives in ${row.task.path}`}>
                {row.task.noteTitle}
              </span>
            )}
            {row.kind === 'project' && row.project.status !== 'active' && (
              <span
                className={`planner-status ${row.project.status}`}
                title={
                  row.project.status === 'complete'
                    ? 'Completed — nothing new can be added until it is reopened'
                    : `Target end ${row.project.dueDate} has passed with work still open`
                }
              >
                {row.project.status === 'complete' ? 'done' : 'overdue'}
              </span>
            )}
            {row.kind === 'project' && (
              <span className="planner-row-percent">{row.project.percent}%</span>
            )}
            {row.kind === 'deliverable' && (
              <span className="planner-row-percent">{row.deliverable.percent}%</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
