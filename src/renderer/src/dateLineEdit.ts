import type { EditorView } from '@codemirror/view'
import type { VaultPath } from '@shared/types'
import { samePath } from '@shared/pathUtils'
import { isStaleError } from '@shared/errors'
import { getActiveEditorView } from '@/editor/activeView'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useUiStore } from '@/stores/uiStore'
import { setDueDate } from '@/taskMeta'

/**
 * Shared "change the 📅 date on one exact source line" rewrite, used by any
 * calendar-picker date edit that isn't driven from inside the editor itself
 * (Timeline tasks/milestones, the Machine Log). Same two-path rule as the
 * board (boardActions.ts):
 *  - Source note open in the editor → dispatch a CM transaction on the live
 *    buffer (never write to disk behind an unsaved buffer's back).
 *  - Note not open → verified disk rewrite via the main process, which
 *    aborts with KNOTE_STALE instead of guessing when the file changed.
 */

export interface DateLineTarget {
  path: VaultPath
  line: number
  rawLine: string
}

function staleToast(): void {
  useUiStore.getState().showToast('Note changed on disk — refreshed')
}

/** The target's note is open in the active editor pane — its live buffer, or null. */
function activeViewFor(target: DateLineTarget): EditorView | null {
  const ws = useWorkspaceStore.getState()
  const view = getActiveEditorView()
  if (!view || !ws.note || !samePath(ws.note.path, target.path)) return null
  return view
}

/** Returns true if the change was applied to a live editor buffer. */
function tryBufferRewrite(
  view: EditorView,
  lineNo: number,
  rawLine: string,
  newLine: string
): boolean {
  const doc = view.state.doc
  // Verify by content, not just line number — the buffer may have shifted
  let target = -1
  if (lineNo + 1 <= doc.lines && doc.line(lineNo + 1).text === rawLine) {
    target = lineNo + 1
  } else {
    for (let i = 1; i <= doc.lines; i++) {
      if (doc.line(i).text === rawLine) {
        if (target !== -1) return false // ambiguous — let the disk path decide
        target = i
      }
    }
  }
  if (target === -1) return false
  const line = doc.line(target)
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: newLine },
    userEvent: 'input.knote.editDate'
  })
  return true
}

/** Verified rewrite of one exact source line to `newLine` (no-op if unchanged). */
export async function rewriteLine(target: DateLineTarget, newLine: string): Promise<void> {
  if (newLine === target.rawLine) return

  const view = activeViewFor(target)
  if (view && tryBufferRewrite(view, target.line, target.rawLine, newLine)) return

  try {
    await window.knote.replaceLine(target.path, target.line, target.rawLine, newLine)
  } catch (err) {
    if (isStaleError(err)) staleToast()
    else throw err
  }
}

/** Change a line's 📅 date in place (or clear it when `date` is null). */
export async function setLineDate(target: DateLineTarget, date: string | null): Promise<void> {
  await rewriteLine(target, setDueDate(target.rawLine, date))
}
