// The spell-check engine shared by every KNote text box — the note editor, the
// task dialog's title, table cells and plain inputs (inputSpellCheck.ts). Wraps typo-js with the
// bundled en_US Hunspell dictionary (inlined as strings by esbuild — no file
// or network load, so it stays fully offline), plus two extra word sets layered
// on top of the base dictionary:
//
//   - the persisted personal dictionary (VaultConfig.userDictionary, fed in via
//     setPersonalWords), which survives across sessions, and
//   - a session-only "ignore" set (ignoreWord), cleared when the webview reloads.
//
// Building the Typo table parses ~50k entries, so it's kicked off lazily and
// off the initial render (loadDictionary) — squiggles appear a beat after the
// note opens rather than blocking it.

import Typo from 'typo-js'
import affData from 'typo-js/dictionaries/en_US/en_US.aff'
import dicData from 'typo-js/dictionaries/en_US/en_US.dic'
import { useConfigStore } from '../stores'

let typo: Typo | null = null
let loadPromise: Promise<void> | null = null

/** Words the user added to their vault's personal dictionary (lower-cased). */
const personalWords = new Set<string>()
/** Words ignored for this session only (lower-cased). */
const ignoredWords = new Set<string>()

/**
 * Parse the bundled dictionary (once). Deferred to a macrotask so the ~50k-word
 * table build doesn't jank the editor's first paint. Safe to call repeatedly —
 * later calls return the same in-flight/settled promise.
 */
export function loadDictionary(): Promise<void> {
  if (!loadPromise) {
    loadPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        typo = new Typo('en_US', affData, dicData)
        resolve()
      }, 0)
    })
  }
  return loadPromise
}

export function isDictionaryReady(): boolean {
  return typo != null
}

/** Replace the personal dictionary (from VaultConfig.userDictionary). */
export function setPersonalWords(words: string[]): void {
  personalWords.clear()
  for (const w of words) personalWords.add(w.toLowerCase())
}

/** Ignore a word for the rest of this session (not persisted). */
export function ignoreWord(word: string): void {
  ignoredWords.add(word.toLowerCase())
  notify()
}

const listeners = new Set<() => void>()
let started = false

function notify(): void {
  for (const cb of listeners) cb()
}

/**
 * Subscribe to "the answer to checkWord may have changed" — the dictionary
 * finished loading, or a word was added to the personal dictionary or ignored.
 * Starts the engine on first use. Returns an unsubscribe function.
 */
export function onSpellingChanged(cb: () => void): () => void {
  startSpellCheck()
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/**
 * Load the dictionary and keep the personal word list in step with the vault
 * config (an "Add to dictionary" here, or a configChanged from another view).
 * Once per webview; safe to call repeatedly.
 */
function startSpellCheck(): void {
  if (started) return
  started = true
  let applied = useConfigStore.getState().vaultConfig.userDictionary ?? []
  setPersonalWords(applied)
  useConfigStore.subscribe(() => {
    const words = useConfigStore.getState().vaultConfig.userDictionary ?? []
    if (words === applied) return
    applied = words
    setPersonalWords(words)
    notify()
  })
  void loadDictionary().then(notify)
}

/**
 * True when `word` is spelled correctly — i.e. in the base dictionary, the
 * personal dictionary, or the session ignore list. Returns true (skip) until
 * the dictionary has finished loading so nothing is flagged prematurely.
 */
export function checkWord(word: string): boolean {
  if (!typo) return true
  const lower = word.toLowerCase()
  if (personalWords.has(lower) || ignoredWords.has(lower)) return true
  return typo.check(word)
}

/** Up to `limit` suggested corrections for a misspelled word, best first. */
export function suggestWords(word: string, limit = 7): string[] {
  return typo ? typo.suggest(word, limit) : []
}
