// Persists which sections are folded in the live-preview editor, so a note
// reopens with the same task blocks / heading sections collapsed.
//
// Folds have no stable id to key on — they can start on a task line, a plain
// list line, or (via the markdown language's own folding) a heading — so the
// only content-stable handle is the folded line's own trimmed text. That's
// good enough for a personal note tool: two identical-text lines are simply
// indistinguishable, so restoring folds a matching count of the earliest
// lines sharing that text rather than a specific instance.

import type { EditorState, StateEffect } from '@codemirror/state'
import { foldable, foldEffect, foldedRanges } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { vscodeApi } from '../shared/rpc'

/** Trimmed text of each currently-folded line, one entry per folded range. */
export function foldedLineKeys(state: EditorState): string[] {
  const keys: string[] = []
  foldedRanges(state).between(0, state.doc.length, (from) => {
    keys.push(state.doc.lineAt(from).text.trim())
  })
  return keys
}

/**
 * The fold effects needed to re-fold whichever lines match the saved keys.
 * Uses `foldable` (the same lookup `foldCode`/the fold gutter use) rather
 * than recomputing a range directly, so it works whether the fold came from
 * indentation-based task folding or the markdown language's own heading
 * folding. Split out from `applyFoldedLineKeys` so it can be unit-tested
 * against a plain `EditorState` — building an `EditorView` needs a DOM.
 */
export function foldEffectsFor(
  state: EditorState,
  keys: readonly string[]
): StateEffect<unknown>[] {
  if (keys.length === 0) return []
  const need = new Map<string, number>()
  for (const key of keys) need.set(key, (need.get(key) ?? 0) + 1)

  const effects: StateEffect<unknown>[] = []
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    const text = line.text.trim()
    const remaining = need.get(text)
    if (!remaining) continue
    const range = foldable(state, line.from, line.to)
    if (!range) continue
    effects.push(foldEffect.of(range))
    need.set(text, remaining - 1)
  }
  return effects
}

/** Re-fold whichever lines match the saved keys. */
export function applyFoldedLineKeys(view: EditorView, keys: readonly string[]): void {
  const effects = foldEffectsFor(view.state, keys)
  if (effects.length > 0) view.dispatch({ effects })
}

/** Reports the current fold state to the host whenever it changes. */
export const foldPersistence = EditorView.updateListener.of((update) => {
  if (foldedRanges(update.startState) === foldedRanges(update.state)) return
  vscodeApi.postMessage({ type: 'knote:fold-state', keys: foldedLineKeys(update.state) })
})
