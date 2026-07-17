// Right-click menu actions for a misspelled word: replace it with a suggestion,
// add it to the persisted personal dictionary, or ignore it for this session.

import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { host } from '../../shared/rpc'
import { useConfigStore } from '../../shared/stores'
import { ignoreWord } from './dictionary'
import { recheckSpelling, type WordSpan } from './spellCheck'

/** Replace the misspelled word with the chosen correction. */
export function replaceWord(view: EditorView, span: WordSpan, replacement: string): void {
  view.dispatch({
    changes: { from: span.from, to: span.to, insert: replacement },
    selection: EditorSelection.cursor(span.from + replacement.length)
  })
  view.focus()
}

/**
 * Add a word to the vault's personal dictionary (persisted in config.json).
 * Updates the config store optimistically so the spell checker re-runs
 * immediately; the host write emits configChanged to reconcile other webviews.
 */
export function addToDictionary(word: string): void {
  const config = useConfigStore.getState().vaultConfig
  if (config.userDictionary.includes(word)) return
  const updated = { ...config, userDictionary: [...config.userDictionary, word] }
  useConfigStore.setState({ vaultConfig: updated })
  void host.setVaultConfig(updated)
}

/** Stop flagging this word for the rest of the session (not persisted). */
export function ignoreSpelling(view: EditorView, word: string): void {
  ignoreWord(word)
  recheckSpelling(view)
}
