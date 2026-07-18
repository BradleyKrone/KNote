// Board→file writes, now a thin layer over the host RPC: the extension
// host's verifiedEdit decides whether each edit lands in a live editor
// buffer (note open in VS Code) or as a verified atomic disk write, and
// refuses with KNOTE_STALE instead of clobbering when the file changed.

import dayjs from 'dayjs'
import { isStaleError } from '@shared/errors'
import { ARCHIVED_CHAR, statusChangedLineForTask, TASK_LINE_RE } from '@shared/parser/patterns'
import { host } from '../shared/rpc'
import { showToast, useConfigStore } from '../shared/stores'
import type { BoardCard, BoardScope } from './boardSelectors'

function staleToast(): void {
  showToast('Note changed on disk — board refreshed')
}

async function guarded(op: Promise<void>): Promise<void> {
  try {
    await op
  } catch (err) {
    if (isStaleError(err)) staleToast()
    else throw err
  }
}

/**
 * Change a task's status char. `reasonLine`, when given (a `Reason for
 * <Column>: ... 📅 <date>` line for a column that requires one), is
 * inserted directly under the task in the same rewrite. Whenever the char
 * actually changes, a `Status Changed: <date>` line is stamped/refreshed.
 */
export async function setCardStatus(
  card: BoardCard,
  targetChar: string,
  reasonLine?: string
): Promise<void> {
  const m = TASK_LINE_RE.exec(card.rawLine)
  if (!m) return
  const statusChangedLine =
    targetChar !== m[3]
      ? statusChangedLineForTask(card.rawLine, dayjs().format('M/D/YYYY'))
      : undefined
  await guarded(
    host.setTaskStatusMeta(card.path, card.line, card.rawLine, targetChar, {
      reasonLine,
      statusChangedLine
    })
  )
}

/** Archive a card: strikes through its line in the note and drops it off the board. */
export async function archiveCard(card: BoardCard): Promise<void> {
  await setCardStatus(card, ARCHIVED_CHAR)
}

/**
 * Archive every given card, one at a time. Sequential on purpose: each
 * archive is a read-modify-write against its note file, so archiving several
 * cards from the same note in parallel would race and drop edits.
 */
export async function archiveCards(cards: BoardCard[]): Promise<void> {
  for (const card of cards) {
    await archiveCard(card)
  }
}

/** Same-note reorder: move the card's line before another card's line. */
export async function reorderCard(card: BoardCard, before: BoardCard | null): Promise<void> {
  if (before && card.path !== before.path) {
    showToast('Cards can only be reordered within the same note')
    return
  }
  await guarded(
    host.moveLine(
      card.path,
      card.line,
      card.rawLine,
      before ? before.line : -1,
      before ? before.rawLine : null
    )
  )
}

/** Replace a card's task text (status char and indentation preserved). */
export async function updateCardText(card: BoardCard, newText: string): Promise<void> {
  const m = TASK_LINE_RE.exec(card.rawLine)
  if (!m) return
  const clean = newText.trim().replace(/\s*\n\s*/g, ' ')
  if (!clean || clean === card.text) return
  // indent + bullet + " [c]" ends at m[1].len + m[2].len + 4
  const prefix = card.rawLine.slice(0, m[1].length + m[2].length + 4)
  await guarded(host.replaceLine(card.path, card.line, card.rawLine, `${prefix} ${clean}`))
}

export async function deleteCard(card: BoardCard): Promise<void> {
  await guarded(host.deleteLine(card.path, card.line, card.rawLine))
}

/**
 * "Add card": appends a checkbox line to the scoped note or the inbox.
 * `reasonLine`, when given, is appended as a second (attached-note) line
 * directly under the new task.
 */
export async function addCard(
  scope: BoardScope,
  statusChar: string,
  text: string,
  reasonLine?: string
): Promise<void> {
  await useConfigStore.getState().load()
  const config = useConfigStore.getState().vaultConfig
  const target = scope.kind === 'note' ? scope.path : config.inboxNote
  const line =
    `- [${statusChar}] ${text.trim()}` + (reasonLine !== undefined ? '\n' + reasonLine : '')
  await host.appendToNote(target, line)
}

/** Open the card's source note in a VS Code editor, landing on its line. */
export function openSource(card: BoardCard): void {
  void host.openNote(card.path, card.line)
}
