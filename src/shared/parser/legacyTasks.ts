// The pre-`@task` rule for "which checkbox lines were Kanban cards", kept alive
// for exactly one caller: the `knote.migrateLegacyTasks` command, which uses it
// to decide what to mark when converting a vault written before the switch.
//
// Nothing in the running product may use this. Task-ness is the `@task` marker
// and nothing else (`isTaskLine`); if indentation could still promote a
// checkbox anywhere, the switch wouldn't be a switch.

import { maskSource } from './mdScaffold'
import { isTaskLine, TASK_LINE_RE } from './patterns'

/**
 * 0-based line numbers, in document order, of checkbox lines that *would* have
 * been Kanban cards under the old rule and don't already carry `@task`.
 *
 * The old rule, lifted verbatim from what `collectTasks` used to compute as
 * `TaskItem.isSubtask`: a stack of open ancestor task indents, so a checkbox
 * indented deeper than the nearest preceding checkbox above it was that one's
 * subtask, and anything else was a card.
 *
 * Run against the *masked* source, so a `- [ ] fake` inside a fenced code
 * sample is left alone — it was never a card, and the parser still won't read
 * it as one. A line that already carries the marker is skipped but still
 * pushed onto the stack: it was a card before and stays an ancestor, so its
 * children keep being recognised as subtasks. That, plus the skip itself, is
 * what makes running the migration twice a no-op.
 */
export function legacyTaskLines(content: string): number[] {
  const masked = maskSource(content)
  if (!masked) return []
  const maskedLines = masked.masked.split('\n')
  const rawLines = content.split('\n')

  const out: number[] = []
  const taskIndentStack: number[] = []
  for (let i = 0; i < maskedLines.length; i++) {
    // Matched on the masked line, read off the raw one — same contract as
    // `parseNote`'s `scanLines`, so the two always agree on what is a task line.
    if (!TASK_LINE_RE.test(maskedLines[i].replace(/\r$/, ''))) continue
    const rawLine = (rawLines[i] ?? '').replace(/\r$/, '')
    const m = TASK_LINE_RE.exec(rawLine)
    if (!m) continue

    const indent = m[1].length
    while (taskIndentStack.length && taskIndentStack[taskIndentStack.length - 1] >= indent) {
      taskIndentStack.pop()
    }
    const wasCard = taskIndentStack.length === 0
    taskIndentStack.push(indent)

    if (wasCard && !isTaskLine(rawLine)) out.push(i)
  }
  return out
}
