import { samePath } from '@shared/pathUtils'
import { TASK_LINE_RE } from '@shared/parser/patterns'
import { getActiveEditorView } from '@/editor/activeView'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import type { BoardCard, BoardScope } from './boardSelectors'

/**
 * Board→file writes. Two paths, per the plan:
 *  - Source note open in the editor → dispatch a CM transaction on the live
 *    buffer (never write to disk behind an unsaved buffer's back).
 *  - Note not open → verified disk rewrite via the main process, which
 *    aborts with KNOTE_STALE instead of guessing when the file changed.
 */

function staleToast(): void {
  useUiStore.getState().showToast('Note changed on disk — board refreshed')
}

/** Returns true if the change was applied to a live editor buffer. */
function tryBufferRewrite(card: BoardCard, mutate: (lineFrom: number, lineText: string) => boolean): boolean {
  const ws = useWorkspaceStore.getState()
  const view = getActiveEditorView()
  if (!view || !ws.note || !samePath(ws.note.path, card.path)) return false

  const doc = view.state.doc
  // Verify by content, not just line number — the buffer may have shifted
  let target = -1
  if (card.line + 1 <= doc.lines && doc.line(card.line + 1).text === card.rawLine) {
    target = card.line + 1
  } else {
    for (let i = 1; i <= doc.lines; i++) {
      if (doc.line(i).text === card.rawLine) {
        if (target !== -1) return false // ambiguous — let the disk path decide
        target = i
      }
    }
  }
  if (target === -1) return false
  const line = doc.line(target)
  return mutate(line.from, line.text)
}

export async function setCardStatus(card: BoardCard, targetChar: string): Promise<void> {
  const m = TASK_LINE_RE.exec(card.rawLine)
  if (!m) return
  const bracketOffset = m[1].length + m[2].length + 2
  const newLine =
    card.rawLine.slice(0, bracketOffset) + targetChar + card.rawLine.slice(bracketOffset + 1)

  const applied = tryBufferRewrite(card, (lineFrom) => {
    getActiveEditorView()!.dispatch({
      changes: { from: lineFrom + bracketOffset, to: lineFrom + bracketOffset + 1, insert: targetChar },
      userEvent: 'input.knote.toggleTask'
    })
    return true
  })
  if (applied) return

  try {
    await window.knote.replaceLine(card.path, card.line, card.rawLine, newLine)
  } catch (err) {
    if (String(err).includes('KNOTE_STALE')) staleToast()
    else throw err
  }
}

/** Same-note reorder: move the card's line before another card's line. */
export async function reorderCard(card: BoardCard, before: BoardCard | null): Promise<void> {
  if (before && !samePath(card.path, before.path)) {
    useUiStore.getState().showToast('Cards can only be reordered within the same note')
    return
  }
  const applied = tryBufferRewrite(card, (lineFrom, lineText) => {
    const view = getActiveEditorView()!
    const doc = view.state.doc
    let insertPos: number
    if (before === null) {
      insertPos = doc.length
    } else {
      let beforeLineNo = -1
      for (let i = 1; i <= doc.lines; i++) {
        if (doc.line(i).text === before.rawLine) {
          beforeLineNo = i
          break
        }
      }
      if (beforeLineNo === -1) return false
      insertPos = doc.line(beforeLineNo).from
    }
    const sourceLine = doc.lineAt(lineFrom)
    const removeFrom = sourceLine.from
    const removeTo = Math.min(sourceLine.to + 1, doc.length)
    if (insertPos >= removeFrom && insertPos <= removeTo) return true // no-op move
    view.dispatch({
      changes: [
        { from: removeFrom, to: removeTo },
        { from: insertPos, insert: lineText + '\n' }
      ],
      userEvent: 'input.knote.moveTask'
    })
    return true
  })
  if (applied) return

  try {
    await window.knote.moveLine(
      card.path,
      card.line,
      card.rawLine,
      before ? before.line : -1,
      before ? before.rawLine : null
    )
  } catch (err) {
    if (String(err).includes('KNOTE_STALE')) staleToast()
    else throw err
  }
}

export async function deleteCard(card: BoardCard): Promise<void> {
  const applied = tryBufferRewrite(card, (lineFrom) => {
    const view = getActiveEditorView()!
    const line = view.state.doc.lineAt(lineFrom)
    view.dispatch({
      changes: { from: line.from, to: Math.min(line.to + 1, view.state.doc.length) },
      userEvent: 'input.knote.deleteTask'
    })
    return true
  })
  if (applied) return
  try {
    await window.knote.deleteLine(card.path, card.line, card.rawLine)
  } catch (err) {
    if (String(err).includes('KNOTE_STALE')) staleToast()
    else throw err
  }
}

/** "Add card": appends a checkbox line to the scoped note or the inbox. */
export async function addCard(scope: BoardScope, statusChar: string, text: string): Promise<void> {
  await useSettingsStore.getState().loadVaultConfig()
  const config = useSettingsStore.getState().vaultConfig
  const target = scope.kind === 'note' ? scope.path : config.inboxNote
  const line = `- [${statusChar}] ${text.trim()}`

  // If the target note is open with unsaved edits, append via the buffer
  const ws = useWorkspaceStore.getState()
  const view = getActiveEditorView()
  if (view && ws.note && samePath(ws.note.path, target)) {
    const doc = view.state.doc
    const needsNewline = doc.length > 0 && doc.sliceString(doc.length - 1) !== '\n'
    view.dispatch({
      changes: { from: doc.length, insert: (needsNewline ? '\n' : '') + line + '\n' },
      userEvent: 'input.knote.addTask'
    })
    return
  }
  await window.knote.appendToNote(target, line)
}
