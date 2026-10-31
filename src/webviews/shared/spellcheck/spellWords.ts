// Which words in a piece of text count as misspelled. Pure — no dictionary,
// DOM or CodeMirror — so the note editor's plugin (spellCheck.ts), the plain
// <input>/<textarea> overlay (inputSpellCheck.ts) and the unit tests all make
// exactly the same decisions. The caller supplies the dictionary lookup.

import { TAG_RE, WIKI_LINK_RE } from '@shared/parser/patterns'

/** A word plus its offsets in the text it was found in. */
export interface WordSpan {
  from: number
  to: number
  word: string
}

// Words: letter runs, allowing internal apostrophes (don't, it's). Digits and
// underscores are excluded so code-ish identifiers fall out via adjacency below.
const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g
// A word touching one of these characters is part of an identifier/number/path
// (test2, snake_case, a/b, foo.bar, name@host) — not prose, so skip it.
const ADJACENT = /[0-9_@/\\]/
// Bare URLs and email addresses.
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\w.+-]+@[\w-]+\.[\w.-]+/g

/**
 * Ranges of `text` that aren't prose even in plain text: wiki-links, #tags,
 * bare URLs and emails. Offsets are shifted by `base`.
 */
export function patternSkipRanges(text: string, base = 0): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const re of [WIKI_LINK_RE, TAG_RE, URL_RE]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) != null) ranges.push([base + m.index, base + m.index + m[0].length])
  }
  return ranges
}

/**
 * Every misspelled word in `text`, in order. `skip` holds extra ranges to
 * ignore (offsets in `text`); `before`/`after` are the characters just outside
 * the slice, so a word cut at its edge is still judged by its neighbours.
 */
export function findMisspellings(
  text: string,
  isCorrect: (word: string) => boolean,
  skip: Array<[number, number]> = [],
  edges: { before?: string; after?: string } = {}
): WordSpan[] {
  const spans: WordSpan[] = []
  const ranges = [...skip, ...patternSkipRanges(text)]
  WORD_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WORD_RE.exec(text)) != null) {
    const word = m[0]
    if (word.length < 2) continue
    // Skip words with an internal capital (camelCase, PascalCase, acronyms like
    // KNote / GitHub / USA) — technical tokens, not prose typos.
    if (/[A-Z]/.test(word.slice(1))) continue
    const from = m.index
    const to = from + word.length
    const before = from > 0 ? text[from - 1] : (edges.before ?? '')
    const after = to < text.length ? text[to] : (edges.after ?? '')
    if (ADJACENT.test(before) || ADJACENT.test(after)) continue
    if (ranges.some(([s, e]) => from < e && to > s)) continue
    if (isCorrect(word)) continue
    spans.push({ from, to, word })
  }
  return spans
}
