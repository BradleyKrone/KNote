// Board→file writes, now a thin layer over the host RPC: the extension
// host's verifiedEdit decides whether each edit lands in a live editor
// buffer (note open in VS Code) or as a verified atomic disk write, and
// refuses with KNOTE_STALE instead of clobbering when the file changed.

import dayjs from 'dayjs'
import { isStaleError } from '@shared/errors'
import { ARCHIVED_CHAR, statusChangedLineForTask, TASK_LINE_RE } from '@shared/parser/patterns'
import {
  anchorLine,
  blockIdOf,
  blockLink,
  linkAlias,
  makeBlockId,
  withoutAnchor
} from '@shared/blockAnchor'
import { host } from '../shared/rpc'
import { showToast, useConfigStore, useIndexStore } from '../shared/stores'
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

/**
 * Replace a card's task text (status char and indentation preserved). The
 * card's `^anchor` is carried over rather than taken from the new text: it's
 * kept out of the edit box (see Card.tsx), so it isn't the editor's to lose —
 * dropping it would silently break every link pointing at this task.
 */
export async function updateCardText(card: BoardCard, newText: string): Promise<void> {
  const m = TASK_LINE_RE.exec(card.rawLine)
  if (!m) return
  const clean = withoutAnchor(newText.trim().replace(/\s*\n\s*/g, ' '))
  if (!clean || clean === withoutAnchor(card.text)) return
  // indent + bullet + " [c]" ends at m[1].len + m[2].len + 4
  const prefix = card.rawLine.slice(0, m[1].length + m[2].length + 4)
  const id = blockIdOf(card.rawLine)
  const rewritten = id ? anchorLine(`${prefix} ${clean}`, id) : `${prefix} ${clean}`
  await guarded(host.replaceLine(card.path, card.line, card.rawLine, rewritten))
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

/**
 * Copy a `[[Note#^id|Task text]]` link to this card's task, minting the block
 * anchor in the source note first if the line doesn't carry one yet. The board
 * is where tasks actually get browsed, so this is the main way to grab a link
 * without opening the note and hunting for the anchor.
 *
 * The anchor write is a normal verified edit, so it lands in the live buffer
 * when the note is open and refuses (rather than clobbers) when it's stale.
 */
export async function copyCardLink(card: BoardCard): Promise<void> {
  let id = blockIdOf(card.rawLine)
  if (!id) {
    const taken = useIndexStore.getState().notes.get(card.path)?.blockIds ?? []
    id = makeBlockId(
      card.rawLine,
      taken.map((b) => b.id)
    )
    try {
      await host.replaceLine(card.path, card.line, card.rawLine, anchorLine(card.rawLine, id))
    } catch (err) {
      // Nothing was written, so there's no anchor to link to — don't copy a
      // link that would dangle.
      if (isStaleError(err)) return staleToast()
      throw err
    }
  }
  const link = blockLink(card.noteTitle, id, linkAlias(card.displayText))
  await host.copyToClipboard(link)
  showToast(`Copied link: ${link}`)
}
