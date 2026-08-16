// Persists which sections are folded in the live-preview editor, so a note
// reopens with the same task blocks / heading sections collapsed.
//
// Folds have no stable id to key on — they can start on a task line, a plain
// list line, or (via the markdown language's own folding) a heading — so the
// only content-stable handle is the folded line's own trimmed text. That's
// good enough for a personal note tool: two identical-text lines are simply
// indistinguishable, so restoring folds a matching count of the earliest
// lines sharing that text rather than a specific instance.

import { Annotation, type EditorState, type StateEffect } from '@codemirror/state'
import { foldable, foldEffect, foldedRanges, forceParsing } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { vscodeApi } from '../shared/rpc'

/** Budget for the whole-document parse a restore forces — see applyFoldedLineKeys. */
export const FOLD_PARSE_MS = 1000

/** Marks the restore transaction, so it isn't written straight back to the host. */
const restoringFolds = Annotation.define<boolean>()

/**
 * Set when a restore's forced parse ran out of budget, so some saved folds could
 * not be resolved. Persistence then stays off for the rest of the session: a
 * fold set read back from a half-resolved restore is missing entries, and
 * writing it back would delete them permanently. Failing to save is recoverable
 * — the note simply reopens the way it last saved — while saving a truncated
 * set is not.
 */
let persistSuspended = false

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
  // Nothing to restore — and in particular, no reason to make an unfolded note
  // pay for a full parse just to open.
  if (keys.length === 0) return

  // Heading folds come from lang-markdown's `headerIndent` fold service, which
  // answers by walking `syntaxTree(state)`. A freshly created EditorState is
  // parsed only as far as CodeMirror's Work.InitViewport — the first 3000
  // characters — so every heading past that point resolves to the tree's top
  // node, is refused, and its saved fold is silently skipped. Task folds come
  // from taskFold's indentation-based service and never needed the tree, which
  // is why the loss looked arbitrary: short notes and task blocks restored,
  // headings further down long notes never did.
  //
  // forceParsing dispatches an empty transaction to publish the extended tree
  // (syntaxTree reads the Language StateField, so ensureSyntaxTree alone would
  // not be enough). Being a no-change transaction it leaves foldedRanges'
  // identity untouched, so it doesn't trip foldPersistence below.
  if (!forceParsing(view, view.state.doc.length, FOLD_PARSE_MS)) persistSuspended = true

  const effects = foldEffectsFor(view.state, keys)
  if (effects.length > 0) view.dispatch({ effects, annotations: restoringFolds.of(true) })
}

/** Reports the current fold state to the host whenever it changes. */
export const foldPersistence = EditorView.updateListener.of((update) => {
  if (foldedRanges(update.startState) === foldedRanges(update.state)) return
  if (persistSuspended) return
  // The restore's own dispatch must not be echoed back: if it resolved only
  // some of the saved keys, the host would overwrite the stored list with that
  // subset and the rest would be gone for good — even after the parser caught
  // up, and even if the note was never edited.
  if (update.transactions.some((t) => t.annotation(restoringFolds))) return
  vscodeApi.postMessage({ type: 'knote:fold-state', keys: foldedLineKeys(update.state) })
})
