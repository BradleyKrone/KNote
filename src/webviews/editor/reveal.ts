// When does one rendered construct — a link, an image or video embed, a wiki
// link, bold/italic marks, a checkbox — swap back to its raw markdown?
//
// Per construct, never per line: only when the selection is actually inside
// it. A caret elsewhere on the line (say, after clicking the blank space to
// add text) leaves everything on the line rendered and clickable.
//
// The one wrinkle is the keyboard. A widget-rendered construct (an image, a
// `[[wiki link]]`) is a single atomic range, so the arrow keys hop straight
// over it and the caret can never land strictly inside. So when the caret got
// where it is by keyboard, sitting right against a construct's edge reveals it
// too; when it got there by mouse, it doesn't — that's exactly where a click
// beside a construct parks the caret.

import { type EditorState, StateField } from '@codemirror/state'
import { rangeTouches } from './mdLinkLogic'

/** True when the selection last moved by keyboard rather than by mouse. */
export const keyboardCaret = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    if (!tr.selection) return value
    if (tr.isUserEvent('select.pointer')) return false
    if (tr.isUserEvent('select')) return true
    // Typing and other edits carry the caret along without changing how it
    // arrived.
    return value
  }
})

/** True when the construct at [from, to) should show its raw markdown. */
export function rangeRevealed(state: EditorState, from: number, to: number): boolean {
  const edges = state.field(keyboardCaret, false) ?? false
  return rangeTouches(state.selection.ranges, from, to, edges)
}
