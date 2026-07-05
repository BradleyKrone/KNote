import { ChevronDown, ChevronRight } from 'lucide-react'
import { EditorView } from '@codemirror/view'
import { useUiStore } from '@/stores/uiStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { getActiveEditorView } from '@/editor/activeView'

function jumpToLine(line: number): void {
  const view = getActiveEditorView()
  if (!view || line >= view.state.doc.lines) return
  const linePos = view.state.doc.line(line + 1).from
  view.dispatch({
    selection: { anchor: linePos },
    effects: EditorView.scrollIntoView(linePos, { y: 'start', yMargin: 60 })
  })
  view.focus()
}

export function OutlinePanel(): React.JSX.Element | null {
  const notePath = useWorkspaceStore((s) => s.note?.path ?? null)
  const headings = useWorkspaceStore((s) => s.outlineHeadings)
  const collapsed = useUiStore((s) => s.outlineCollapsed)
  const toggleOutline = useUiStore((s) => s.toggleOutline)

  if (!notePath) return null

  return (
    <div className="right-section">
      <div className="right-section-title section-header" onClick={toggleOutline}>
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <span>Outline</span>
      </div>
      {!collapsed &&
        (headings.length === 0 ? (
          <div className="panel-empty">No headings in this note</div>
        ) : (
          headings.map((h, i) => (
            <div
              key={`${h.line}-${i}`}
              className="outline-row"
              style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
              onClick={() => jumpToLine(h.line)}
            >
              {h.text || 'Untitled heading'}
            </div>
          ))
        ))}
    </div>
  )
}
