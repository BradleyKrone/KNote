/**
 * Regexes shared by the indexer (parseNote) and the editor decorations.
 * Kept dependency-free so the renderer can import them without pulling in
 * the remark toolchain.
 */

/** [[target]], [[target#heading]], [[target|alias]], ![[embed]] */
export const WIKI_LINK_RE = /(!?)\[\[([^[\]|#\n]+)(#[^[\]|\n]+)?(\|[^[\]\n]+)?\]\]/g

/**
 * ` ^block-id` at the end of a line — an Obsidian-style block anchor that
 * `[[Note#^block-id]]` links can jump to. Group 1 = the id.
 */
export const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/

/** #tag — must follow start-of-line/whitespace/bracket; purely numeric tags excluded by callers */
export const TAG_RE = /(^|[\s([{])#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g

/** - [x] task line (any single status char inside the brackets) */
export const TASK_LINE_RE = /^(\s*)([-*+]|\d+[.)])\s\[(.)\](?:\s(.*))?$/

/** @due(2026-07-10) or 📅 2026-07-10 */
export const DUE_RE = /(?:@due\((\d{4}-\d{2}-\d{2})\)|📅\s*(\d{4}-\d{2}-\d{2}))/

/**
 * `Reason for <Column>: <reason> 📅 <date>` — an indented line attached
 * under a task (same nesting convention as a plain task note), written when
 * the task moves into a column configured with `requireReason` (e.g.
 * Waiting). Group 1 = indent, group 2 = column name, group 3 = reason,
 * group 4 = date.
 */
export const REASON_FOR_RE = /^(\s+)Reason for (.+?):\s*(.*?)\s*📅\s*(\d{4}-\d{2}-\d{2})\s*$/

/** Builds the indented `Reason for <Column>: <reason> 📅 <date>` line attached under a task. */
export function formatReasonLine(
  indent: string,
  columnName: string,
  reason: string,
  date: string
): string {
  return `${indent}Reason for ${columnName}: ${reason} 📅 ${date}`
}

/** Builds a reason line nested one level deeper than the given task line's own indent. */
export function reasonLineForTask(
  taskLineText: string,
  columnName: string,
  reason: string,
  date: string
): string {
  const m = TASK_LINE_RE.exec(taskLineText)
  const indent = (m ? m[1] : '') + '  '
  return formatReasonLine(indent, columnName, reason, date)
}

/** Value a `Status Changed` line holds before the task's first status change. */
export const STATUS_CHANGED_UNSET = 'n/a'

/**
 * `- Status Changed: <date | n/a>` — an indented line attached under a task,
 * seeded as `n/a` when the task's note template is created and then updated
 * (in place, never duplicated) to today's date every time the task's Kanban
 * column changes (any status-char rewrite, board drag or editor status menu),
 * independent of `Reason for <Column>` which only fires for columns
 * configured with `requireReason`. `n/a` here must stay in sync with
 * `STATUS_CHANGED_UNSET`.
 */
export const STATUS_CHANGED_RE =
  /^\s*(?:[-*+]|\d+[.)])\s+Status Changed:\s*(\d{1,2}\/\d{1,2}\/\d{4}|n\/a)\s*$/i

/**
 * `- Date Entered: <date>` — an indented line attached under a task, seeded
 * once when the task's note template is created (see `insertTaskNoteLine`).
 * Group 1 = the date. Used both to detect an already-seeded template and (by
 * the indexer) to expose the value for the board's Date Entered filter.
 */
export const DATE_ENTERED_RE =
  /^\s*(?:[-*+]|\d+[.)])\s+Date Entered:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*$/i

/** Builds a status-changed line nested one level deeper than the given task line's own indent. */
export function statusChangedLineForTask(taskLineText: string, date: string): string {
  const m = TASK_LINE_RE.exec(taskLineText)
  const indent = (m ? m[1] : '') + '  '
  return `${indent}- Status Changed: ${date}`
}

/**
 * Merges the `Reason for <Column>` / `Status Changed` lines that sit
 * immediately under a task into their canonical order (reason first, so it
 * stays adjacent to the task the way `collectTasks` expects, then status
 * changed), replacing whichever of `updates` supplies a value and preserving
 * whichever it doesn't — so a plain column move doesn't clobber an existing
 * reason, and re-stating a reason doesn't clobber the status-changed stamp.
 * `peekLines` are the (up to two) lines immediately following the task line,
 * read fresh from whatever the caller's source of truth is (a live editor
 * buffer or the file just read off disk).
 */
export function mergeTaskMetaLines(
  peekLines: string[],
  updates: { reasonLine?: string; statusChangedLine?: string }
): { consumed: number; lines: string[] } {
  let consumed = 0
  let existingReason: string | undefined
  let existingStatus: string | undefined
  for (const line of peekLines) {
    if (existingReason === undefined && REASON_FOR_RE.test(line)) {
      existingReason = line
      consumed++
      continue
    }
    if (existingStatus === undefined && STATUS_CHANGED_RE.test(line)) {
      existingStatus = line
      consumed++
      continue
    }
    break
  }
  const lines: string[] = []
  const reason = updates.reasonLine ?? existingReason
  if (reason !== undefined) lines.push(reason)
  const status = updates.statusChangedLine ?? existingStatus
  if (status !== undefined) lines.push(status)
  return { consumed, lines }
}

/** A list-item line (`- `, `* `, `1. `) — the meta/note lines under a task are these. */
export const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s/

/**
 * Exclusive end index of a task's *own* attached-note block within `lines`:
 * the contiguous run below the task that is blank, indented deeper than the
 * task, or a same-indent plain list item — i.e. its note lines (reason,
 * status, Date Entered, Notes, free text). It stops at the first checkbox
 * line of any depth, so a nested subtask (and its own meta) is never swept
 * in, and trailing blanks are excluded. Returns `taskIdx + 1` for a task
 * with no note.
 */
export function ownNoteBlockEnd(lines: string[], taskIdx: number, taskIndentLen: number): number {
  let lastNonBlank = taskIdx
  for (let i = taskIdx + 1; i < lines.length; i++) {
    const text = lines[i]
    if (/^\s*$/.test(text)) continue
    const indent = /^[ \t]*/.exec(text)?.[0].length ?? 0
    if (TASK_LINE_RE.test(text)) break
    if (indent < taskIndentLen) break
    if (indent === taskIndentLen && !LIST_ITEM_RE.test(text)) break
    lastNonBlank = i
  }
  return lastNonBlank + 1
}

/**
 * Plan the edit that updates a task's attached `Reason for <Column>` /
 * `Status Changed` lines. Unlike the old 2-line peek, this searches the
 * task's whole own-note block (`ownNoteBlockEnd`) so an existing line is
 * found and updated *in place* even when a blank line or note text sits
 * between it and the task — and any duplicate reason/status lines are
 * collapsed to one. Canonical order is reason first (kept on the line right
 * under the task, where `collectTasks` reads it), then status changed, then
 * the rest of the note untouched. Returns a splice: replace
 * `lines[start .. start+deleteCount)` with `insert`.
 */
export function planTaskMetaEdit(
  lines: string[],
  taskIdx: number,
  updates: { reasonLine?: string; statusChangedLine?: string }
): { start: number; deleteCount: number; insert: string[] } {
  const m = TASK_LINE_RE.exec(lines[taskIdx])
  const indentLen = m ? m[1].length : 0
  const end = ownNoteBlockEnd(lines, taskIdx, indentLen)
  const block = lines.slice(taskIdx + 1, end)

  let existingReason: string | undefined
  let existingStatus: string | undefined
  const rest: string[] = []
  for (const line of block) {
    if (REASON_FOR_RE.test(line)) {
      if (existingReason === undefined) existingReason = line
      continue
    }
    if (STATUS_CHANGED_RE.test(line)) {
      if (existingStatus === undefined) existingStatus = line
      continue
    }
    rest.push(line)
  }
  // Drop blank lines that sit at the top of the block, between the
  // auto-managed reason/status lines and the note content below — moves must
  // never leave (or accumulate) a gap there. Blank lines further down, within
  // the user's own note text, are left alone.
  while (rest.length > 0 && /^\s*$/.test(rest[0])) rest.shift()

  const insert: string[] = []
  const reason = updates.reasonLine ?? existingReason
  if (reason !== undefined) insert.push(reason)
  const status = updates.statusChangedLine ?? existingStatus
  if (status !== undefined) insert.push(status)
  insert.push(...rest)
  return { start: taskIdx + 1, deleteCount: block.length, insert }
}

/** !, !!, or !!! priority marker — must stand alone (whitespace/line boundaries) */
export const PRIORITY_RE = /(?:^|\s)(!{1,3})(?=\s|$)/

/**
 * Strip due-date/priority/tag markers out of raw task-or-milestone-or-machine
 * text, leaving just the prose. Used wherever an entry is rendered as a label:
 * board cards, timeline rows, machine entries, and the activity-bar trees.
 */
export function stripInlineMarkers(text: string): string {
  return text
    .replace(DUE_RE, '')
    .replace(PRIORITY_RE, ' ')
    .replace(/(^|[\s([{])#[A-Za-z0-9_][A-Za-z0-9_/-]*/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** 🏁 milestone line — a standalone dated timeline entry, deliberately not a checkbox so it never becomes a Kanban card */
export const MILESTONE_LINE_RE = /^\s*🏁\s+(.*)$/

/**
 * 🚜 machine work-log entry: `🚜 <serial> <activity…>`. Group 1 is the serial
 * (first whitespace-delimited token); group 2 is the activity text, which may
 * carry #tags and a 📅 date. Like milestones, deliberately not a checkbox so it
 * never becomes a Kanban card.
 */
export const MACHINE_ENTRY_RE = /^\s*🚜\s+(\S+)\s*(.*)$/

/**
 * Reserved checkbox status char for archived tasks — `- [a] ...`. Archived
 * tasks stay in their note as a struck-through line but never appear on the
 * Kanban board, regardless of the vault's configured columns.
 */
export const ARCHIVED_CHAR = 'a'
