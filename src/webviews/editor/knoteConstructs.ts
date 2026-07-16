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
  DATE_ENTERED_RE,
  MACHINE_ENTRY_RE,
  MILESTONE_LINE_RE,
  PRIORITY_RE,
  REASON_FOR_RE,
  reasonLineForTask,
  STATUS_CHANGED_RE,
  statusChangedLineForTask,
  TAG_RE,
  TASK_LINE_RE,
  WIKI_LINK_RE
} from '@shared/parser/patterns'
import { host } from '../shared/rpc'
import { promptReason, showToast, useConfigStore } from '../shared/stores'
import { checkboxRange, nextColumn } from './constructLogic'

// One webview edits exactly one note; its vault-relative path is set at init.
let notePath: string | null = null
export function setNotePath(path: string | null): void {
  notePath = path
}

// Standard markdown image: ![alt](src)
const MD_IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/g

/**
 * Set a task line's checkbox to a specific Kanban column: a verified write that
 * prompts for a reason when the column requires one and stamps `Status Changed`.
 * Shared by the checkbox click (via cycleCheckbox) and the right-click status
 * menu. No-op when the char is already `target.char`.
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

/** Click a checkbox: advance the task to the next Kanban column (verified write). */
async function cycleCheckbox(line0: number, rawLine: string): Promise<void> {
  const m = TASK_LINE_RE.exec(rawLine)
  if (!m || notePath === null) return
  const current = m[3]
  if (current === ARCHIVED_CHAR) return // archived cards don't cycle on click
  const next = nextColumn(useConfigStore.getState().vaultConfig.columns, current)
  if (!next) return
  await setCheckboxStatus(line0, rawLine, next)
}

// ---------- Widgets ----------

class CheckboxWidget extends WidgetType {
  constructor(
    private readonly statusChar: string,
    private readonly line0: number,
    private readonly rawLine: string
  ) {
    super()
  }
  eq(other: CheckboxWidget): boolean {
    return (
      other.statusChar === this.statusChar &&
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
    box.title = 'Click to advance status'
    // Don't let the click move the cursor into the line (which would reveal it).
    box.addEventListener('mousedown', (e) => e.preventDefault())
    box.addEventListener('click', (e) => {
      e.preventDefault()
      void cycleCheckbox(this.line0, this.rawLine)
    })
    return box
  }
  ignoreEvent(): boolean {
    return false
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
  ignoreEvent(): boolean {
    return false
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

  for (const visible of view.visibleRanges) {
    let pos = visible.from
    while (pos <= visible.to) {
      const line = doc.lineAt(pos)
      decorateLine(view, line, revealed.has(line.number), decorations)
      pos = line.to + 1
    }
  }
  return Decoration.set(decorations, true)
}

function decorateLine(
  view: EditorView,
  line: { from: number; to: number; number: number; text: string },
  isRevealed: boolean,
  out: Range<Decoration>[]
): void {
  const text = line.text

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
    if (!isRevealed) {
      const from = line.from + box.from
      out.push(
        Decoration.replace({
          widget: new CheckboxWidget(box.statusChar, line.number - 1, text)
        }).range(from, line.from + box.to)
      )
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
