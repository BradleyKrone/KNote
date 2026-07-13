import { isStaleError } from '@shared/errors'
import { getActiveEditorView } from '@/editor/activeView'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useUiStore } from '@/stores/uiStore'
import { samePath } from '@shared/pathUtils'
import { setLineDate } from '@/dateLineEdit'
import type { TimelineItem } from './timelineSelectors'

/**
 * Timeline→file writes. Tasks/milestones go through the shared single-line
 * date rewrite (dateLineEdit.ts); notes need their own frontmatter-property
 * rewrite below, following the same live-buffer-or-verified-disk rule.
 */

function staleToast(): void {
  useUiStore.getState().showToast('Note changed on disk — timeline refreshed')
}

/** The item's note is open in the active editor pane — its live buffer, or null. */
function activeViewFor(item: TimelineItem) {
  const ws = useWorkspaceStore.getState()
  const view = getActiveEditorView()
  if (!view || !ws.note || !samePath(ws.note.path, item.path)) return null
  return view
}

/** Change a task or milestone's 📅 date in place (or clear it when `date` is null). */
async function setLineItemDate(item: TimelineItem, date: string | null): Promise<void> {
  if (item.rawLine === undefined) return
  await setLineDate({ path: item.path, line: item.line, rawLine: item.rawLine }, date)
}

/** Locates a frontmatter `key: value` line in `lines` (the whole file, split into lines). */
function findFrontmatterKeyLine(lines: string[], key: string): number {
  if (lines[0]?.trim() !== '---') return -1
  const keyRe = new RegExp(`^${key}\\s*:`, 'i')
  for (let i = 1; i < Math.min(lines.length, 200); i++) {
    if (lines[i].trim() === '---') return -1
    if (keyRe.test(lines[i])) return i
  }
  return -1
}

/** Change a note's `date`/`due`/`deadline` frontmatter property (or remove it when `date` is null). */
async function setNoteFrontmatterDate(item: TimelineItem, date: string | null): Promise<void> {
  const key = item.frontmatterKey
  if (!key) return
  const newText = date === null ? null : `${key}: ${date}`

  const view = activeViewFor(item)
  if (view) {
    const doc = view.state.doc
    const lines: string[] = []
    for (let i = 1; i <= doc.lines; i++) lines.push(doc.line(i).text)
    const target = findFrontmatterKeyLine(lines, key)
    if (target === -1) return
    const line = doc.line(target + 1)
    if (newText === null) {
      const to = target + 1 < doc.lines ? doc.line(target + 2).from : line.to
      view.dispatch({
        changes: { from: line.from, to },
        userEvent: 'input.knote.editTimelineDate'
      })
    } else if (newText !== line.text) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: newText },
        userEvent: 'input.knote.editTimelineDate'
      })
    }
    return
  }

  try {
    const { content } = await window.knote.readFile(item.path)
    const lines = content.split(/\r?\n/)
    const target = findFrontmatterKeyLine(lines, key)
    if (target === -1) return
    const expectedText = lines[target]
    if (newText === null) {
      await window.knote.deleteLine(item.path, target, expectedText)
    } else if (newText !== expectedText) {
      await window.knote.replaceLine(item.path, target, expectedText, newText)
    }
  } catch (err) {
    if (isStaleError(err)) staleToast()
    else throw err
  }
}

/** Change any timeline item's date in place (or clear it when `date` is null), whatever its source. */
export async function setTimelineItemDate(item: TimelineItem, date: string | null): Promise<void> {
  if (item.kind === 'note') return setNoteFrontmatterDate(item, date)
  return setLineItemDate(item, date)
}
