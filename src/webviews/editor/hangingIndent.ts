// Hanging indent for the live-preview editor: how far a line's *wrapped*
// continuation must be pushed right so it tucks under the line's own text
// instead of falling back flush-left. knoteConstructs.ts turns the number into
// a `--knote-hang` custom property on the line; editor.css turns that into
// padding-left plus a matching negative text-indent.
//
// Pure and measurement-free by design: one width per line *shape* (indent depth
// + marker kind), so it costs nothing per line and — the point — is identical
// whether or not the line is cursor-revealed, so the caret arriving on a line
// never shifts it sideways.
//
// The constants are real Segoe UI advance widths (the font --vscode-font-family
// resolves to on Windows). theme.ts puts the editor in a *proportional* font,
// so `ch` units are useless here and a per-line measure/relayout pass would be
// the only exact answer — deliberately not worth it. Another UI font shifts
// these by a pixel or two, which is invisible.

import { LIST_ITEM_RE, TASK_LINE_RE } from '@shared/parser/patterns'

const SPACE_EM = 0.274
const DIGIT_EM = 0.539
const ORDERED_DOT_EM = 0.217
const ORDERED_PAREN_EM = 0.302
/** `•` at font-weight 700 — see .cm-knote-bullet in editor.css. */
const BULLET_EM = 0.422
/** The literal `-`/`*`/`+` a task line keeps (its marker isn't swapped for a `•`). */
const MARKER_EM: Record<string, number> = { '-': 0.4, '*': 0.417, '+': 0.684 }

/**
 * The checkbox widget's footprint, derived from CSS rather than font metrics:
 * `.cm-knote-check` is `width: 1.05em` + `margin-right: .25em` at
 * `font-size: .85em` (editor.css), and `box-sizing: border-box` is global
 * (shared/webview.css), so its border sits inside that width. Keep in sync with
 * those declarations.
 */
const CHECKBOX_EM = 0.85 * (1.05 + 0.25)

/**
 * Visual width of leading whitespace, in space-widths. A tab advances to the
 * next multiple of 4 to match CSS `tab-size`, which CodeMirror sets from
 * `EditorState.tabSize` — deliberately NOT taskFold's `indentColumns`, which
 * counts a tab as 2 because it measures structural nesting depth, not pixels.
 */
const TAB_SIZE = 4
function leadingColumns(indent: string): number {
  let col = 0
  for (const ch of indent) {
    if (ch === '\t') col += TAB_SIZE - (col % TAB_SIZE)
    else col += 1
  }
  return col
}

/** Width of a list marker in em, excluding the space that follows it. */
function markerEm(marker: string, asBullet: boolean): number {
  const literal = MARKER_EM[marker]
  if (literal !== undefined) return asBullet ? BULLET_EM : literal
  return (marker.length - 1) * DIGIT_EM + (marker.endsWith(')') ? ORDERED_PAREN_EM : ORDERED_DOT_EM)
}

const round = (em: number): number => Math.round(em * 1000) / 1000

/**
 * Hanging-indent width for `text` in em, or null when the line needs none — a
 * flush-left, unmarked line, which is every heading, paragraph and blank line.
 *
 * Everything live preview hides or swaps on these lines sits *before* the
 * visible text, and the leading whitespace is always live text, so measuring
 * the rendered prefix is enough.
 */
export function hangingIndentEm(text: string): number | null {
  // Task: indent, marker, space, [checkbox widget], space, text. The marker is
  // NOT swapped for a `•` on a task line (see knoteConstructs.decorateLine).
  const task = TASK_LINE_RE.exec(text)
  if (task) {
    return round(
      leadingColumns(task[1]) * SPACE_EM +
        markerEm(task[2], false) +
        SPACE_EM +
        CHECKBOX_EM +
        SPACE_EM
    )
  }
  // List: `-`/`*`/`+` render as a `•`; ordered markers stay as typed.
  const item = LIST_ITEM_RE.exec(text)
  if (item) {
    return round(leadingColumns(item[1]) * SPACE_EM + markerEm(item[2], true) + SPACE_EM)
  }
  // Any other indented line — a task's note lines, free text under a bullet.
  const indent = /^[ \t]+/.exec(text)
  if (indent && text.trim() !== '') return round(leadingColumns(indent[0]) * SPACE_EM)
  return null
}
