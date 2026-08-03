// The left pane: the numbered, collapsible project → deliverable → task tree.
// It shares the chart's single scroll container and sticks to the left edge,
// so the two panes can never drift out of vertical sync.

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
  width: number
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

export function TreePane({
  rows,
  tops,
  height,
  collapsed,
  onToggle,
  onOpen,
  onContextMenu,
  width
}: Props): React.JSX.Element {
  return (
    // Rows are positioned, not stacked: the chart places its bars at the same
    // offsets, and a flow layout here would drift the moment a row's height or
    // margin changed on one side only.
    <div className="planner-tree" style={{ width, height }}>
      {rows.map((row, i) => {
        const collapsible = row.kind === 'project' || row.kind === 'deliverable'
        const isCollapsed = collapsed.has(row.key)
        return (
          <div
            key={row.key}
            className={[
              'planner-tree-row',
              `depth-${row.depth}`,
              row.kind === 'task' && row.task.done ? 'done' : '',
              row.kind === 'project' && row.project.complete ? 'project-complete' : '',
              // A rule above every project but the first, so one project's
              // deliverables never read as the next one's.
              row.kind === 'project' && i > 0 ? 'project-start' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ height: ROW_HEIGHT, top: tops[i] }}
            onDoubleClick={() => onOpen(row)}
            onContextMenu={(e) => onContextMenu(e, row)}
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
            <span className="planner-row-label" title={rowLabel(row)}>
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
