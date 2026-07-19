// KNote-specific live-preview rendering, layered on top of livePreview.ts.
// These constructs aren't in the Lezer markdown tree, so they're detected
// with the same regexes the indexer uses (@shared/parser/patterns) and
// rendered as widgets/decorations that call the existing host RPCs:
//
//   • clickable checkboxes  → cycle Kanban columns via host.setTaskStatusMeta
//   • [[wiki links]]        → clickable chips, host.openWikiTarget on click
//   • ![[embed]] / ![](img) → inline images via host.attachmentUri
//   • #tags                 → styled pills
//   • priority / milestone / machine / auto-meta lines → dimmed/emphasized
//
// Like livePreview, raw syntax is revealed on the line(s) under the selection
// so everything stays directly editable.

import dayjs from 'dayjs'
import { syntaxTree } from '@codemirror/language'
import type { Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from '@codemirror/view'
import { isStaleError } from '@shared/errors'
import type { BoardColumn } from '@shared/types'
import {
  ARCHIVED_CHAR,
  BLOCK_ID_RE,
  DATE_ENTERED_RE,
  MACHINE_ENTRY_RE,
  MILESTONE_LINE_RE,
  PRIORITY_RE,
  REASON_FOR_RE,
  reasonLineForTask,
  setTaskDone,
  STATUS_CHANGED_RE,
  statusChangedLineForTask,
  TAG_RE,
  TASK_LINE_RE,
  WIKI_LINK_RE
} from '@shared/parser/patterns'
import { host } from '../shared/rpc'
import { promptReason, showToast, useConfigStore } from '../shared/stores'
import { checkboxRange } from './constructLogic'

// One webview edits exactly one note; its vault-relative path is set at init.
let notePath: string | null = null
export function setNotePath(path: string | null): void {
  notePath = path
}
export function getNotePath(): string | null {
  return notePath
}

// Standard markdown image: ![alt](src)
const MD_IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/g

/**
 * Set a task line's checkbox to a specific Kanban column: a verified write that
 * prompts for a reason when the column requires one and stamps `Status Changed`.
 * Driven by the right-click status menu. No-op when the char is already
 * `target.char`.
 */
export async function setCheckboxStatus(
  line0: number,
  rawLine: string,
  target: BoardColumn
): Promise<void> {
  const m = TASK_LINE_RE.exec(rawLine)
  if (!m || notePath === null) return
  const current = m[3]
  if (target.char === current) return

  let reasonLine: string | undefined
  if (target.requireReason) {
    const res = await promptReason(target.name)
    if (!res) return // user cancelled → abort the move
    reasonLine = reasonLineForTask(rawLine, target.name, res.reason, res.date)
  }
  const statusChangedLine = statusChangedLineForTask(rawLine, dayjs().format('M/D/YYYY'))
  try {
    await host.setTaskStatusMeta(notePath, line0, rawLine, target.char, {
      reasonLine,
      statusChangedLine
    })
  } catch (err) {
    if (isStaleError(err)) showToast('Note changed on disk — try again')
    else throw err
  }
}

/**
 * Rewrite a sub-task line to checked/unchecked via a verified full-line
 * replace, keeping a trailing `✅ <date>` completion marker in sync — added
 * with today's date on check, removed on uncheck. Sub-tasks are simple
 * toggles, not Kanban cards, so no reason prompt or `Status Changed` stamp.
 * No-op when the line isn't a task or nothing changes.
 */
async function rewriteSubtask(line0: number, rawLine: string, done: boolean): Promise<void> {
  if (notePath === null) return
  const newLine = setTaskDone(rawLine, done, dayjs().format('YYYY-MM-DD'))
  if (newLine === null || newLine === rawLine) return
  try {
    await host.replaceLine(notePath, line0, rawLine, newLine)
  } catch (err) {
    if (isStaleError(err)) showToast('Note changed on disk — try again')
    else throw err
  }
}

/** Flip a sub-task between checked and unchecked (stamping/clearing its date). Driven by a click. */
async function toggleSubtask(line0: number, rawLine: string): Promise<void> {
  const m = TASK_LINE_RE.exec(rawLine)
  if (!m) return
  const done = m[3] === 'x' || m[3] === 'X'
  await rewriteSubtask(line0, rawLine, !done)
}

/** Set a sub-task's checked state explicitly. Driven by the right-click menu. */
export async function setSubtaskChecked(
  line0: number,
  rawLine: string,
  checked: boolean
): Promise<void> {
  await rewriteSubtask(line0, rawLine, checked)
}

// ---------- Widgets ----------

class CheckboxWidget extends WidgetType {
  constructor(
    private readonly statusChar: string,
    private readonly subtask: boolean,
    private readonly line0: number,
    private readonly rawLine: string
  ) {
    super()
  }
  eq(other: CheckboxWidget): boolean {
    return (
      other.statusChar === this.statusChar &&
      other.subtask === this.subtask &&
      other.line0 === this.line0 &&
      other.rawLine === this.rawLine
    )
  }
  toDOM(): HTMLElement {
    const box = document.createElement('span')
    box.className = 'cm-knote-check'
    box.dataset.status = this.statusChar
    const done = this.statusChar === 'x' || this.statusChar === 'X'
    box.textContent = done ? '✓' : this.statusChar.trim() === '' ? '' : this.statusChar
    if (this.subtask) {
      // Sub-tasks are plain toggles: a click flips checked/unchecked directly
      // (no caret placement, no Kanban status). preventDefault on mousedown
      // keeps the editor from stealing focus / moving the caret first.
      box.classList.add('cm-knote-check-subtask')
      box.title = 'Click to toggle'
      box.addEventListener('mousedown', (e) => e.preventDefault())
      box.addEventListener('click', (e) => {
        e.preventDefault()
        void toggleSubtask(this.line0, this.rawLine)
      })
    } else {
      box.title = 'Right-click to change status'
    }
    return box
  }
  // For a top-level task, let the editor handle clicks like any other
  // character: a click places the caret and reveals the task line so it's
  // directly editable. Status changes go through the right-click menu (or the
  // board). A sub-task's box handles its own click (toggle) instead, so it
  // swallows editor mouse events by returning true.
  ignoreEvent(): boolean {
    return this.subtask
  }
}

/** The Kanban column a top-level task's status char maps to, or null if unknown. */
function taskStateLabel(statusChar: string, columns: BoardColumn[]): string | null {
  if (statusChar === ARCHIVED_CHAR) return 'Archived'
  const norm = statusChar === 'X' ? 'x' : statusChar
  return columns.find((c) => c.char === norm)?.name ?? null
}

/**
 * A small pill trailing a top-level task line, naming the Kanban column its
 * checkbox currently sits in (To Do / In Progress / Done / …), so a note's
 * task states are readable at a glance without opening the board.
 */
class TaskStateWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly statusChar: string
  ) {
    super()
  }
  eq(other: TaskStateWidget): boolean {
    return other.label === this.label && other.statusChar === this.statusChar
  }
  toDOM(): HTMLElement {
    const tag = document.createElement('span')
    tag.className = 'cm-knote-state'
    tag.dataset.status = this.statusChar === 'X' ? 'x' : this.statusChar
    tag.textContent = this.label
    return tag
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** Renders a proper `•` in place of a `-`/`*`/`+` unordered-list marker. */
class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const b = document.createElement('span')
    b.className = 'cm-knote-bullet'
    b.textContent = '•'
    return b
  }
  ignoreEvent(): boolean {
    return true
  }
}

class WikiLinkWidget extends WidgetType {
  constructor(
    private readonly target: string,
    private readonly display: string
  ) {
    super()
  }
  eq(other: WikiLinkWidget): boolean {
    return other.target === this.target && other.display === this.display
  }
  toDOM(): HTMLElement {
    const a = document.createElement('span')
    a.className = 'cm-knote-wikilink'
    a.textContent = this.display
    a.title = this.target
    a.addEventListener('mousedown', (e) => e.preventDefault())
    a.addEventListener('click', (e) => {
      e.preventDefault()
      void host.openWikiTarget(this.target)
    })
    return a
  }
  // Ignore editor-level mouse events (the default) so a click follows the link
  // rather than placing the caret and revealing the raw `[[link]]` markdown.
  ignoreEvent(): boolean {
    return true
  }
}

class ImageWidget extends WidgetType {
  constructor(private readonly src: string) {
    super()
  }
  eq(other: ImageWidget): boolean {
    return other.src === this.src
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-knote-image'
    const img = document.createElement('img')
    img.alt = this.src
    void host.attachmentUri(this.src).then((uri) => {
      if (uri) img.src = uri
      else wrap.classList.add('cm-knote-image-missing')
    })
    wrap.appendChild(img)
    return wrap
  }
}

// ---------- Decoration builder ----------

function revealedLines(view: EditorView): Set<number> {
  const lines = new Set<number>()
  for (const r of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(r.from).number
    const last = view.state.doc.lineAt(r.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

/** True when pos sits inside a GFM table (rendered separately by tableRender). */
function inTable(view: EditorView, pos: number): boolean {
  for (let n = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent!) {
    if (n.name === 'Table') return true
    if (!n.parent) break
  }
  return false
}

/** True when pos sits inside inline code or a fenced/indented code block. */
function inCode(view: EditorView, pos: number): boolean {
  for (let n = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent!) {
    const name = n.name
    if (
      name === 'InlineCode' ||
      name === 'FencedCode' ||
      name === 'CodeText' ||
      name === 'CodeBlock' ||
      name === 'Comment'
    ) {
      return true
    }
    if (!n.parent) break
  }
  return false
}

function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const revealed = revealedLines(view)
  const { doc } = view.state
  const columns = useConfigStore.getState().vaultConfig.columns

  for (const visible of view.visibleRanges) {
    let pos = visible.from
    while (pos <= visible.to) {
      const line = doc.lineAt(pos)
      decorateLine(view, line, revealed.has(line.number), columns, decorations)
      pos = line.to + 1
    }
  }
  return Decoration.set(decorations, true)
}

function decorateLine(
  view: EditorView,
  line: { from: number; to: number; number: number; text: string },
  isRevealed: boolean,
  columns: BoardColumn[],
  out: Range<Decoration>[]
): void {
  const text = line.text

  // Inside a table that's rendered as a widget, tableRender owns the line —
  // don't add overlapping decorations (they'd clash with the block replace).
  if (!isRevealed && inTable(view, line.from)) return

  // Whole-line styling (always applied, never hidden).
  if (REASON_FOR_RE.test(text) || STATUS_CHANGED_RE.test(text) || DATE_ENTERED_RE.test(text)) {
    out.push(Decoration.line({ class: 'cm-knote-meta' }).range(line.from))
  } else if (MILESTONE_LINE_RE.test(text)) {
    out.push(Decoration.line({ class: 'cm-knote-milestone' }).range(line.from))
  } else if (MACHINE_ENTRY_RE.test(text)) {
    out.push(Decoration.line({ class: 'cm-knote-machine' }).range(line.from))
  }

  // Task checkbox: replace the `[c]` bracket with a clickable widget.
  const box = checkboxRange(text)
  if (box) {
    if (box.statusChar === ARCHIVED_CHAR) {
      out.push(Decoration.line({ class: 'cm-knote-archived' }).range(line.from))
    }
    // Top-level tasks get a pill naming their current Kanban column, placed
    // right after the checkbox.
    if (!box.isSubtask) {
      const label = taskStateLabel(box.statusChar, columns)
      if (label) {
        out.push(
          Decoration.widget({
            widget: new TaskStateWidget(label, box.statusChar),
            side: 1
          }).range(line.from + box.to)
        )
      }
    }
    if (!isRevealed) {
      const from = line.from + box.from
      out.push(
        Decoration.replace({
          widget: new CheckboxWidget(box.statusChar, box.isSubtask, line.number - 1, text)
        }).range(from, line.from + box.to)
      )
    }
  }

  // Unordered-list bullets: swap `-`/`*`/`+` for a `•` (task lines keep their
  // marker — they're handled by the checkbox widget above, so `box` is set).
  if (!box) {
    const bullet = /^(\s*)[-*+](\s)/.exec(text)
    if (bullet && !isRevealed) {
      const from = line.from + bullet[1].length
      out.push(Decoration.replace({ widget: new BulletWidget() }).range(from, from + 1))
    }
  }

  // Priority markers (!, !!, !!!) — style the marker, never hide.
  const prio = PRIORITY_RE.exec(text)
  if (prio && prio.index !== undefined) {
    const markStart = line.from + prio.index + prio[0].indexOf('!')
    out.push(
      Decoration.mark({ class: 'cm-knote-priority' }).range(markStart, markStart + prio[1].length)
    )
  }

  // Wiki links and embeds.
  WIKI_LINK_RE.lastIndex = 0
  for (let m = WIKI_LINK_RE.exec(text); m; m = WIKI_LINK_RE.exec(text)) {
    const from = line.from + m.index
    const to = from + m[0].length
    if (inCode(view, from)) continue
    const isEmbed = m[1] === '!'
    const target = m[2] + (m[3] ?? '')
    if (isEmbed) {
      if (!isRevealed) {
        out.push(Decoration.replace({ widget: new ImageWidget(m[2]) }).range(from, to))
      }
    } else if (!isRevealed) {
      const alias = m[4] ? m[4].slice(1) : ''
      const display = alias || m[2] + (m[3] ?? '') || (m[3] ?? '')
      out.push(Decoration.replace({ widget: new WikiLinkWidget(target, display) }).range(from, to))
    }
  }

  // Standard markdown images: ![alt](src)
  MD_IMAGE_RE.lastIndex = 0
  for (let m = MD_IMAGE_RE.exec(text); m; m = MD_IMAGE_RE.exec(text)) {
    const from = line.from + m.index
    const to = from + m[0].length
    if (inCode(view, from) || isRevealed) continue
    out.push(Decoration.replace({ widget: new ImageWidget(m[1]) }).range(from, to))
  }

  // #tags — style as pills, never hidden.
  TAG_RE.lastIndex = 0
  for (let m = TAG_RE.exec(text); m; m = TAG_RE.exec(text)) {
    const tagName = m[2]
    if (/^\d+$/.test(tagName)) continue // numeric-only isn't a tag (Obsidian rule)
    const hashIndex = m.index + m[1].length
    const from = line.from + hashIndex
    if (inCode(view, from)) continue
    out.push(Decoration.mark({ class: 'cm-knote-tag' }).range(from, from + 1 + tagName.length))
  }

  // Hide a trailing `^block-id` anchor (the target of a [[Note#^id]] link, added
  // by "Copy link to task") in preview — it's link plumbing, not prose. The raw
  // `^id` reveals on the line under the cursor so it stays editable/removable.
  const anchor = BLOCK_ID_RE.exec(text)
  if (anchor && !isRevealed) {
    const from = line.from + anchor.index
    out.push(Decoration.replace({}).range(from, from + anchor[0].length))
  }
}

export const knoteConstructs = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
)
