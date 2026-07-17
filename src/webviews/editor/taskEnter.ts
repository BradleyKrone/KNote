// Auto-seed a task's attached note on Enter.
//
// Pressing Enter at the end of a freshly-typed top-level task line seeds the
// same template as the `knote.insertTaskNote` command — an indented
//   - Status Changed: n/a
//   - Date Entered: <today>
//   - Notes:
// block — and drops the caret on the Notes line. This is the behavior the old
// Electron editor had; here it's a CodeMirror keymap layered ahead of the
// default Enter, so a normal newline still runs everywhere else (and once a
// task is seeded, hitting Enter on it again doesn't duplicate the template).
//
// The decision logic lives in taskNoteSeed.ts (pure, unit-tested); this file
// is just the CodeMirror binding.

import dayjs from 'dayjs'
import { EditorSelection } from '@codemirror/state'
import { EditorView, type KeyBinding } from '@codemirror/view'
import { planTaskNoteSeed } from './taskNoteSeed'

/** Enter handler: apply the seed plan, placing the caret after `- Notes: `. */
function seedTaskNoteOnEnter(view: EditorView): boolean {
  // Build the template with the document's real line break, not a bare `\n`:
  // when EditorState.lineSeparator is set (this editor pins it to the vault
  // file's EOL, `\r\n` on Windows), a lone `\n` is literal text, not a break.
  const plan = planTaskNoteSeed(view.state, dayjs().format('M/D/YYYY'), view.state.lineBreak)
  if (!plan) return false
  view.dispatch({
    changes: { from: plan.at, insert: plan.insert },
    selection: EditorSelection.cursor(plan.at + plan.insert.length),
    scrollIntoView: true,
    userEvent: 'input'
  })
  return true
}

/** Enter-to-seed keymap; register ahead of the default keymap. */
export const taskEnterKeymap: KeyBinding[] = [{ key: 'Enter', run: seedTaskNoteOnEnter }]
