/**
 * Regexes shared by the indexer (parseNote) and the editor decorations.
 * Kept dependency-free so the renderer can import them without pulling in
 * the remark toolchain.
 */

/** [[target]], [[target#heading]], [[target|alias]], ![[embed]] */
export const WIKI_LINK_RE = /(!?)\[\[([^[\]|#\n]+)(#[^[\]|\n]+)?(\|[^[\]\n]+)?\]\]/g

/**
 * Inline markers that can end up *after* a block anchor, burying it: a due
 * date, a completion date, a priority marker, a tag. Every one of these is
 * appended to the end of a task line, so setting one on an already-anchored
 * task used to push the anchor into the middle of the line.
 */
const AFTER_ANCHOR = String.raw`(?:\s*(?:📅\s*\d{4}-\d{2}-\d{2}|@due\(\d{4}-\d{2}-\d{2}\)|🛫\s*\d{4}-\d{2}-\d{2}|@start\(\d{4}-\d{2}-\d{2}\)|✅\s*\d{4}-\d{2}-\d{2}|⛓\s*#[A-Za-z0-9_][A-Za-z0-9_/-]*|⛓\s*@deliverable\([A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\)|@deliverable\([A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\)|!{1,3}|#[A-Za-z0-9_][A-Za-z0-9_/-]*))*`

/**
 * ` ^block-id` at the end of a line — an Obsidian-style block anchor that
 * `[[Note#^block-id]]` links can jump to. Group 1 = the id.
 *
 * Group 2 is any run of markers that displaced the anchor (empty in the normal
 * case). Tolerating those keeps a note written before `preservingBlockId`
 * existed working: its anchor still indexes, still resolves and still hides in
 * live preview instead of showing up as raw `^id` text mid-line. Callers that
 * *remove* the anchor must substitute `'$2'`, not `''`, or they'll take the
 * markers with it.
 */
export const BLOCK_ID_RE = new RegExp(String.raw`(?:^|\s)\^([A-Za-z0-9_-]+)(${AFTER_ANCHOR})\s*$`)

/**
 * Run `fn` over a line's text with any trailing ` ^anchor` held aside, then put
 * the anchor back at the end.
 *
 * Every inline marker is written by appending to the line, so without this a
 * task that already had an anchor ended up as `… ^id 📅 2026-07-28` — and an
 * anchor that isn't last is not a block anchor: it stops being indexed, every
 * `[[Note#^id]]` link to the task breaks, and the raw `^id` becomes visible in
 * live preview. Anything that appends to a task line goes through here.
 *
 * Also repairs a line that was already broken this way, since BLOCK_ID_RE now
 * matches a buried anchor: the markers come back in the body and the anchor
 * lands at the end where it belongs.
 */
export function preservingBlockId(text: string, fn: (text: string) => string): string {
  const m = BLOCK_ID_RE.exec(text)
  if (!m) return fn(text)
  const body = fn((text.slice(0, m.index) + m[2]).replace(/\s+$/, ''))
  return body ? `${body} ^${m[1]}` : `^${m[1]}`
}

/** #tag — must follow start-of-line/whitespace/bracket; purely numeric tags excluded by callers */
export const TAG_RE = /(^|[\s([{])#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g

/** - [x] task line (any single status char inside the brackets) */
export const TASK_LINE_RE = /^(\s*)([-*+]|\d+[.)])\s\[(.)\](?:\s(.*))?$/

/** @due(2026-07-10) or 📅 2026-07-10 */
export const DUE_RE = /(?:@due\((\d{4}-\d{2}-\d{2})\)|📅\s*(\d{4}-\d{2}-\d{2}))/

/**
 * @start(2026-07-10) or 🛫 2026-07-10 — the start half of a project
 * deliverable's date span (the end half is the ordinary `📅` due date). Only
 * the planner reads it; a task without one is a point in time, not a span.
 */
export const START_RE = /(?:@start\((\d{4}-\d{2}-\d{2})\)|🛫\s*(\d{4}-\d{2}-\d{2}))/

/**
 * `⛓ @deliverable(<project>/<name>)` — a scheduling dependency written on a
 * deliverable line, read as "this deliverable comes *after* that one". Global:
 * a deliverable may depend on several. The legacy `⛓ #deliverable/<project>/<name>`
 * form (group 1) still parses, for notes written before the switch to `@`; new
 * writes always emit the `@deliverable(...)` form (groups 2/3) — see `dependsTag`.
 */
export const DEPENDS_RE =
  /⛓\s*(?:#(deliverable\/[A-Za-z0-9_][A-Za-z0-9_/-]*)|@deliverable\(([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\))/g

/** A `DEPENDS_RE` match → the bare `deliverable/<project>/<name>` predecessor tag, whichever form matched. */
export function dependsTag(m: RegExpMatchArray): string {
  return m[1] ?? `deliverable/${m[2]}/${m[3]}`
}

/**
 * `deliverable/<project>/<name>` — the bare tag shape a deliverable's identity
 * always reduces to, whichever marker it was read from (see
 * `DELIVERABLE_REF_RE`, and `deliverableTagsOf` in `shared/deliverables.ts`).
 * Exactly three segments: a two-segment tag is the project itself and a deeper
 * one is rejected, which keeps the namespace from drifting into free-form
 * nesting. Legacy notes may still carry this as a literal `#deliverable/…`
 * tag — that form still reads, but nothing writes it any more.
 */
export const DELIVERABLE_TAG_RE = /^deliverable\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/

/** Splits a bare (no `#`) deliverable tag into its project and deliverable slugs, or null. */
export function parseDeliverableTag(tag: string): { project: string; deliverable: string } | null {
  const m = DELIVERABLE_TAG_RE.exec(tag)
  return m ? { project: m[1], deliverable: m[2] } : null
}

/**
 * `@deliverable(<project>/<name>)` — the one marker for everything about a
 * deliverable's identity: it's how a deliverable's own top-level task
 * declares itself, and how any ordinary task or milestone elsewhere in the
 * vault *joins* one. Deliberately not a `#tag`: it never enters `TAG_RE`, so
 * it can't clutter the Tags sidebar or `#` autocomplete with structural
 * plumbing. What makes a particular line the *defining* one rather than a
 * member is purely structural — a top-level task, in the matching `type:
 * project` note, carrying a `🛫`/`📅` span — never the marker itself; see
 * `deliverableTagsOf` in `shared/deliverables.ts`. Legacy notes may still
 * carry a defining line's identity as a literal `#deliverable/…` tag instead —
 * that still reads, but nothing writes it any more. Global: a line may join
 * more than one deliverable. Group 1 = project, group 2 = name.
 */
export const DELIVERABLE_REF_RE = /@deliverable\(([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\)/g

/** ✅ 2026-07-16 — completion-date marker appended to a checked sub-task line. Group 1 = the date. */
const DONE_DATE_RE = /\s*✅\s*(\d{4}-\d{2}-\d{2})/g

/**
 * Rewrite a task line's checkbox to done/undone while keeping a trailing
 * `✅ <date>` completion marker in sync: appended when checking, stripped when
 * unchecking. Returns the new line text, or null when `rawLine` isn't a task
 * line. Idempotent — an existing marker is replaced, never duplicated — so
 * re-checking an already-done line just refreshes the date.
 */
export function setTaskDone(rawLine: string, done: boolean, date: string): string | null {
  const m = TASK_LINE_RE.exec(rawLine)
  if (!m) return null
  const [, indent, marker] = m
  const text = preservingBlockId(m[4] ?? '', (t) => {
    const stripped = t.replace(DONE_DATE_RE, '').replace(/\s+$/, '')
    if (!done) return stripped
    return stripped ? `${stripped} ✅ ${date}` : `✅ ${date}`
  })
  const body = text ? ` ${text}` : ''
  return `${indent}${marker} [${done ? 'x' : ' '}]${body}`
}

/**
 * `Reason for <Column>: <reason> ⏳ <date>` — an indented line attached
 * under a task (same nesting convention as a plain task note), written when
 * the task moves into a column configured with `requireReason` (e.g.
 * Waiting). Group 1 = indent, group 2 = column name, group 3 = reason,
 * group 4 = the follow-up date — when to come back to the task.
 *
 * `📅` is accepted alongside `⏳` on read: notes written before the date
 * meant "waiting since" still parse, and their date is simply read as the
 * follow-up date (an old one reads as overdue, which is the right nudge).
 * Writes always emit `⏳`, keeping the marker distinct from the `📅` due
 * date that lives in the task text itself.
 */
export const REASON_FOR_RE = /^(\s+)Reason for (.+?):\s*(.*?)\s*(?:⏳|📅)\s*(\d{4}-\d{2}-\d{2})\s*$/

/** Builds the indented `Reason for <Column>: <reason> ⏳ <date>` line attached under a task. */
export function formatReasonLine(
  indent: string,
  columnName: string,
  reason: string,
  followUp: string
): string {
  return `${indent}Reason for ${columnName}: ${reason} ⏳ ${followUp}`
}

/** Builds a reason line nested one level deeper than the given task line's own indent. */
export function reasonLineForTask(
  taskLineText: string,
  columnName: string,
  reason: string,
  followUp: string
): string {
  const m = TASK_LINE_RE.exec(taskLineText)
  const indent = (m ? m[1] : '') + '  '
  return formatReasonLine(indent, columnName, reason, followUp)
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
 * whichever it doesn't — so re-stating a reason doesn't clobber the
 * status-changed stamp. `reasonLine` is three-state: a string sets it,
 * `undefined` leaves whatever is there, and `null` removes it (what a move
 * *out* of a `requireReason` column passes, so the reason doesn't outlive the
 * column it belongs to). `peekLines` are the (up to two) lines immediately
 * following the task line, read fresh from whatever the caller's source of
 * truth is (a live editor buffer or the file just read off disk).
 */
export function mergeTaskMetaLines(
  peekLines: string[],
  updates: { reasonLine?: string | null; statusChangedLine?: string }
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
  const reason = updates.reasonLine === undefined ? existingReason : updates.reasonLine
  if (reason != null) lines.push(reason)
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
 *
 * This is the *narrow* block, and its one remaining job is to bound the
 * auto-managed region: `Reason for` / `Status Changed` / `Date Entered` for
 * this task and no other. Everything nested under the task — sub-tasks and
 * all — is `taskBlockEnd` below. Deliberately fence-blind: the managed lines
 * always sit directly under the task and above any fenced code, so tracking
 * fences here would buy nothing and change what a status change may rewrite.
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

/** A ``` / ~~~ fence line at any indent. Group 1 = the marker run, group 2 = the rest (info string on an opener, nothing on a closer). */
const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/

/**
 * Exclusive end index of a task's *whole* attached block: everything nested
 * under it — its notes, its sub-tasks, their notes, nested bullets, tables and
 * fenced code. A strict superset of `ownNoteBlockEnd`, and what the board's
 * task editor shows and rewrites.
 *
 * It ends at the first line that is outdented past the task, and at a
 * same-indent line that is either a checkbox (a *sibling* task) or not a list
 * item at all (a heading or paragraph). Both of those same-indent halves
 * matter: a sibling `- [ ] next` passes `LIST_ITEM_RE`, so without the
 * checkbox test the block would run to the end of the file.
 *
 * Fenced code is consumed verbatim, with the indent and checkbox rules
 * suspended, so a sample containing `- [ ] fake` stays in the block rather
 * than truncating it. The fence tracking is hand-rolled rather than borrowed
 * from the remark scaffold because `planTaskMetaEdit` runs in the extension
 * host over a plain `string[]` with no parse: read and write have to reach the
 * same answer from the same input, or the board would show one block and
 * overwrite another.
 *
 * A fence only holds while its content stays indented to at least the fence's
 * own column. Dedent past that and the fence has left the list item the task
 * owns — which is how CommonMark reads it too, so remark's mask has already
 * scored a `- [ ] x` down there as a *real* top-level task. Swallowing it
 * would put the same line in two places at once: its own card, and inside this
 * task's block, where the next save would delete it. Both that case and an
 * unterminated fence end the block where it stood before the opener, rather
 * than trusting a fence that turned out not to contain what it looked like it
 * did.
 *
 * Trailing blanks are excluded. Returns `taskIdx + 1` for a task with nothing
 * under it.
 */
export function taskBlockEnd(lines: string[], taskIdx: number, taskIndentLen: number): number {
  let lastNonBlank = taskIdx
  let fence: string | null = null
  let fenceIndent = 0
  // Where the block ended just before the current fence opened, so a fence that
  // turns out not to hold can be backed out of wholesale.
  let beforeFence = taskIdx
  for (let i = taskIdx + 1; i < lines.length; i++) {
    const text = lines[i]
    const blank = /^\s*$/.test(text)
    const indent = blank ? 0 : (/^[ \t]*/.exec(text)?.[0].length ?? 0)
    if (fence !== null) {
      if (!blank && indent < fenceIndent) return beforeFence + 1
      lastNonBlank = i
      const close = FENCE_RE.exec(text)
      if (close && close[1].startsWith(fence) && close[2].trim() === '') fence = null
      continue
    }
    if (blank) continue
    if (indent < taskIndentLen) break
    if (indent === taskIndentLen && (TASK_LINE_RE.test(text) || !LIST_ITEM_RE.test(text))) break
    const open = FENCE_RE.exec(text)
    if (open) {
      beforeFence = lastNonBlank
      fence = open[1]
      fenceIndent = indent
    }
    lastNonBlank = i
  }
  if (fence !== null) return beforeFence + 1
  return lastNonBlank + 1
}

/**
 * Is this note-block line one KNote manages for itself (`Reason for <Column>`,
 * `Status Changed`, `Date Entered`) rather than the user's own note text?
 * The parser keeps these out of `TaskItem.blockLines` and `planTaskMetaEdit`
 * re-emits them itself, so the two have to agree on the boundary — otherwise
 * the board would show one thing and overwrite another.
 */
export function isManagedNoteLine(line: string): boolean {
  return REASON_FOR_RE.test(line) || STATUS_CHANGED_RE.test(line) || DATE_ENTERED_RE.test(line)
}

/**
 * A task's whole attached block (`taskBlockEnd`) as the board's task editor
 * sees it: verbatim and still indented, minus the auto-managed lines that
 * belong to *this* task — the ones inside its narrow `ownNoteBlockEnd` range,
 * which are surfaced as `TaskItem` fields and re-emitted by `planTaskMetaEdit`
 * instead. A *descendant's* own `Status Changed` / `Date Entered` /
 * `Reason for` lines sit outside that range and survive verbatim: they belong
 * to the sub-task, not to this one.
 *
 * The single point of agreement between the three sides that must never
 * drift — the parser reading a block out, the write path replacing one, and
 * the staleness check that refuses a write when the block moved underneath.
 */
export function taskBlockLines(lines: string[], taskIdx: number): string[] {
  const m = TASK_LINE_RE.exec(lines[taskIdx])
  const indentLen = m ? m[1].length : 0
  const narrowEnd = ownNoteBlockEnd(lines, taskIdx, indentLen)
  const wideEnd = taskBlockEnd(lines, taskIdx, indentLen)
  const block = lines
    .slice(taskIdx + 1, wideEnd)
    .filter((line, i) => !(taskIdx + 1 + i < narrowEnd && isManagedNoteLine(line)))
  // Leading blanks sit between the managed lines and the note body; the write
  // path strips them too, so dropping them here keeps round-trips stable.
  while (block.length > 0 && /^\s*$/.test(block[0])) block.shift()
  return block
}

/**
 * Does the task at `taskIdx` still have exactly the block the editor was shown?
 * The staleness check behind `setTaskTextAndNotes`'s `expectedBlock`: a task
 * rewrite now replaces a whole subtree, so verifying the task line alone would
 * let a stale save swallow a sub-task somebody ticked in the meantime.
 */
export function taskBlockMatches(lines: string[], taskIdx: number, expected: string[]): boolean {
  const current = taskBlockLines(lines, taskIdx)
  return current.length === expected.length && current.every((l, i) => l === expected[i])
}

/**
 * Drop auto-managed lines from the head of a replacement body — the part above
 * its first checkbox, which is the region that parses back as *this* task's own
 * meta. Everything from the first sub-task down is that sub-task's and passes
 * through untouched.
 */
function filterOwnManagedLines(body: string[]): string[] {
  const firstBox = body.findIndex((l) => TASK_LINE_RE.test(l))
  const head = firstBox === -1 ? body : body.slice(0, firstBox)
  const tail = firstBox === -1 ? [] : body.slice(firstBox)
  return [...head.filter((l) => !isManagedNoteLine(l)), ...tail]
}

/**
 * Plan the edit that updates a task's attached `Reason for <Column>` /
 * `Status Changed` lines. Unlike the old 2-line peek, this searches the
 * task's whole own-note block (`ownNoteBlockEnd`) so an existing line is
 * found and updated *in place* even when a blank line or note text sits
 * between it and the task — and any duplicate reason/status lines are
 * collapsed to one. Canonical order is reason first (kept on the line right
 * under the task, where `collectTasks` reads it), then status changed, then
 * the rest of the note untouched. `reasonLine` is three-state: a string sets
 * it, `undefined` leaves the existing one alone, and `null` deletes it — the
 * reason is auto-managed metadata that only exists while the task sits in a
 * `requireReason` column, so moving out of one clears it in the same edit —
 * and because the follow-up date rides on that same line, the date goes with
 * it rather than outliving the column it belongs to.
 *
 * `blockLines` replaces the task's whole attached block — everything under it
 * that isn't one of *its own* auto-managed lines, sub-tasks included. It is
 * three-state as well: `undefined` leaves the block alone (what every
 * status-change caller wants), an array replaces it wholesale, and `[]` clears
 * it back to just the managed lines. Supplying it also widens the range being
 * rewritten from `ownNoteBlockEnd` to `taskBlockEnd` — a status change must
 * never reach a sub-task, but the board's task editor edits the whole subtree —
 * and pulls `Date Entered` out of the body to re-emit it with the other managed
 * lines, since left in the body it would be replaced along with the note text,
 * silently losing the date. It stays in the body when `blockLines` is
 * `undefined` so an ordinary status change keeps it exactly where the user put
 * it.
 *
 * Returns a splice: replace `lines[start .. start+deleteCount)` with `insert`.
 */
export function planTaskMetaEdit(
  lines: string[],
  taskIdx: number,
  updates: { reasonLine?: string | null; statusChangedLine?: string; blockLines?: string[] }
): { start: number; deleteCount: number; insert: string[] } {
  const m = TASK_LINE_RE.exec(lines[taskIdx])
  const indentLen = m ? m[1].length : 0
  const replacingBody = updates.blockLines !== undefined
  const narrowEnd = ownNoteBlockEnd(lines, taskIdx, indentLen)
  const end = replacingBody ? taskBlockEnd(lines, taskIdx, indentLen) : narrowEnd
  const block = lines.slice(taskIdx + 1, end)

  let existingReason: string | undefined
  let existingStatus: string | undefined
  let existingDateEntered: string | undefined
  const rest: string[] = []
  for (let i = 0; i < block.length; i++) {
    const line = block[i]
    // Only the managed lines inside the *narrow* block are this task's; past it
    // they belong to a sub-task and are ordinary content here. When the body
    // isn't being replaced the two ranges coincide, so this is always true and
    // the partition is byte-identical to what it has always done.
    const isOwnMeta = taskIdx + 1 + i < narrowEnd
    if (isOwnMeta && REASON_FOR_RE.test(line)) {
      if (existingReason === undefined) existingReason = line
      continue
    }
    if (isOwnMeta && STATUS_CHANGED_RE.test(line)) {
      if (existingStatus === undefined) existingStatus = line
      continue
    }
    if (isOwnMeta && replacingBody && DATE_ENTERED_RE.test(line)) {
      if (existingDateEntered === undefined) existingDateEntered = line
      continue
    }
    rest.push(line)
  }
  // Drop blank lines that sit at the top of the block, between the
  // auto-managed reason/status lines and the note content below — moves must
  // never leave (or accumulate) a gap there. Blank lines further down, within
  // the user's own note text, are left alone. Applied to a replacement body
  // too, so a note typed with a leading newline can't open that gap either.
  // A replacement body is filtered, not trusted: typing `- Status Changed: …`
  // into the notes box would otherwise be promoted to the real stamp on the
  // next parse, clobbering it. Those lines are read-only in the editor, and the
  // host is what enforces that. But only up to the body's first checkbox: past
  // that the line is a *sub-task's* own stamp, which the editor legitimately
  // shows and must round-trip — filtering the whole body would delete every
  // sub-task's `Status Changed` on every save.
  const body = replacingBody ? filterOwnManagedLines(updates.blockLines as string[]) : rest
  while (body.length > 0 && /^\s*$/.test(body[0])) body.shift()
  // Trailing blanks likewise: `ownNoteBlockEnd` never includes them, so leaving
  // them here would grow the block by a line on every save.
  while (body.length > 0 && /^\s*$/.test(body[body.length - 1])) body.pop()

  const insert: string[] = []
  const reason = updates.reasonLine === undefined ? existingReason : updates.reasonLine
  if (reason != null) insert.push(reason)
  const status = updates.statusChangedLine ?? existingStatus
  if (status !== undefined) insert.push(status)
  if (existingDateEntered !== undefined) insert.push(existingDateEntered)
  insert.push(...body)
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
  return (
    text
      // Dependencies first: the generic tag strip below would otherwise eat the
      // tag and leave a bare `⛓` behind in the label.
      .replace(DEPENDS_RE, '')
      .replace(DELIVERABLE_REF_RE, '')
      .replace(DUE_RE, '')
      .replace(START_RE, '')
      .replace(PRIORITY_RE, ' ')
      .replace(/(^|[\s([{])#[A-Za-z0-9_][A-Za-z0-9_/-]*/g, '$1')
      // `$2`, not `''` — a buried anchor's trailing markers belong to the label.
      .replace(BLOCK_ID_RE, '$2')
      .replace(/\s{2,}/g, ' ')
      .trim()
  )
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
