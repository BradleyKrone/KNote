// Task grouping for the live-preview editor.
//
// A task (or any list line) almost always has indented content beneath it —
// its Status Changed / Date Entered / Notes template and any sub-tasks.
//
//  - taskFold folds that block away (Obsidian-style) so a note reads as a
//    clean list of top-level tasks.
//  - taskGroupBox draws a light card around each top-level task and its
//    indented block, so it's obvious at a glance what belongs to which task.
//
// Both work off indentation alone, so they cover sub-tasks, note bodies and
// nested lists, not just checkboxes.

import { EditorState } from '@codemirror/state'
import type { Range } from '@codemirror/state'
import {
  codeFolding,
  foldGutter,
  foldKeymap,
  foldService,
  foldedRanges
} from '@codemirror/language'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate
} from '@codemirror/view'
import { TASK_LINE_RE } from '@shared/parser/patterns'

/** Leading-whitespace width in columns (tabs expand to the next multiple of 2). */
function indentColumns(text: string): number {
  let col = 0
  for (const ch of text) {
    if (ch === ' ') col += 1
    else if (ch === '\t') col += 2 - (col % 2)
    else break
  }
  return col
}

/**
 * Line number (1-based) of the last more-indented child under `parentNum`, or
 * `parentNum` itself when the line is blank or has no indented children. Blank
 * lines interleaved with children are spanned; trailing blanks are not.
 */
function lastChildLine(state: EditorState, parentNum: number): number {
  const doc = state.doc
  const parent = doc.line(parentNum)
  if (parent.text.trim() === '') return parentNum
  const baseIndent = indentColumns(parent.text)

  let last = parentNum
  for (let n = parentNum + 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (line.text.trim() === '') continue // provisional; only kept if a child follows
    if (indentColumns(line.text) > baseIndent) last = n
    else break
  }
  return last
}

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

function indentFoldRange(
  state: EditorState,
  lineStart: number
): { from: number; to: number } | null {
  const parent = state.doc.lineAt(lineStart)
  const last = lastChildLine(state, parent.number)
  if (last === parent.number) return null
  return { from: parent.to, to: state.doc.line(last).to }
}

/** Indentation-based folding plus a hover-revealed fold gutter and keymap. */
const taskFolding = [
  codeFolding(),
  foldService.of((state, lineStart) => indentFoldRange(state, lineStart)),
  foldGutter({
    markerDOM(open) {
      const el = document.createElement('span')
      el.className = 'cm-knote-fold-marker'
      el.textContent = open ? '⌄' : '›'
      return el
    }
  }),
  keymap.of(foldKeymap)
]

// ---------------------------------------------------------------------------
// Group box
// ---------------------------------------------------------------------------

/** Start positions of the currently-folded ranges. */
function foldedStarts(state: EditorState): Set<number> {
  const starts = new Set<number>()
  foldedRanges(state).between(0, state.doc.length, (from) => {
    starts.add(from)
  })
  return starts
}

/**
 * A card around every top-level task line and the indented block beneath it.
 * A folded group collapses to a single line, so its one visible line gets both
 * the first and last edges to stay a closed box.
 */
function buildGroupBoxes(state: EditorState): DecorationSet {
  const doc = state.doc
  const folded = foldedStarts(state)
  const deco: Range<Decoration>[] = []

  let n = 1
  while (n <= doc.lines) {
    const line = doc.line(n)
    const m = TASK_LINE_RE.exec(line.text)
    // Only top-level (unindented) tasks anchor a card; nested sub-tasks are
    // grouped visually by the enclosing card, not boxed again.
    if (!m || m[1].length > 0) {
      n++
      continue
    }
    const last = lastChildLine(state, n)
    if (last === n) {
      n++
      continue // a lone task line with no detail — nothing to group
    }

    const collapsed = folded.has(line.to)
    const endLine = collapsed ? n : last
    for (let k = n; k <= endLine; k++) {
      let cls = 'cm-knote-group-line'
      if (k === n) cls += ' cm-knote-group-first'
      if (k === endLine) cls += ' cm-knote-group-last'
      deco.push(Decoration.line({ class: cls }).range(doc.line(k).from))
    }
    n = last + 1
  }
  return Decoration.set(deco, true)
}

const taskGroupBox = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildGroupBoxes(view.state)
    }
    update(update: ViewUpdate): void {
      // Rebuild on edits and whenever a fold toggles (the fold state field
      // changes identity only then).
      if (update.docChanged || foldedRanges(update.startState) !== foldedRanges(update.state)) {
        this.decorations = buildGroupBoxes(update.view.state)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
)

/** Fold gutter/keymap plus the grouping card around each top-level task. */
export const taskFold = [taskFolding, taskGroupBox]
