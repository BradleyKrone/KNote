// Live-view spell checking. A ViewPlugin scans the visible text, tokenizes it
// into words, and underlines the ones that aren't in the dictionary (see
// dictionary.ts) with a wavy `.cm-spell-error` mark (styled in theme.ts). The
// right-click menu (EditorContextMenu.tsx) uses misspelledRangeAt() to offer
// corrections for the word under the cursor.
//
// Words inside code, links, wiki-links, #tags, bare URLs and the YAML
// frontmatter block are skipped, since those aren't prose and would only
// produce false positives.

import { syntaxTree } from '@codemirror/language'
import { StateEffect } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate
} from '@codemirror/view'
import { TAG_RE, WIKI_LINK_RE } from '@shared/parser/patterns'
import { useConfigStore } from '../../shared/stores'
import { checkWord, isDictionaryReady, loadDictionary, setPersonalWords } from './dictionary'

/** A word plus its absolute document offsets. */
export interface WordSpan {
  from: number
  to: number
  word: string
}

/** Dispatched to force the plugin to re-scan (dictionary loaded, word ignored/added). */
const recheckEffect = StateEffect.define<null>()

/** Re-run spell checking now (e.g. after the personal dictionary changes). */
export function recheckSpelling(view: EditorView): void {
  view.dispatch({ effects: recheckEffect.of(null) })
}

const spellMark = Decoration.mark({ class: 'cm-spell-error' })

// Words: letter runs, allowing internal apostrophes (don't, it's). Digits and
// underscores are excluded so code-ish identifiers fall out via adjacency below.
const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g
// A word touching one of these characters is part of an identifier/number/path
// (test2, snake_case, a/b, foo.bar, name@host) — not prose, so skip it.
const ADJACENT = /[0-9_@/\\]/
// Bare URLs and email addresses.
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\w.+-]+@[\w-]+\.[\w.-]+/g

// Lezer node types whose text isn't prose.
const SKIP_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'URL', 'Autolink', 'Comment'])

/** Character ranges within [from,to) that spell checking must ignore. */
function collectSkipRanges(view: EditorView, from: number, to: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const { doc } = view.state

  syntaxTree(view.state).iterate({
    from,
    to,
    enter: (node) => {
      if (SKIP_NODES.has(node.name)) ranges.push([node.from, node.to])
    }
  })

  // Wiki-links, #tags, URLs and emails are plain text in the markdown tree, so
  // find them by pattern over the visible slice.
  const text = doc.sliceString(from, to)
  for (const re of [WIKI_LINK_RE, TAG_RE, URL_RE]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) != null) ranges.push([from + m.index, from + m.index + m[0].length])
  }

  // The YAML frontmatter block (`---` … `---` at the very top of the note).
  if (doc.lines >= 1 && doc.line(1).text === '---') {
    for (let n = 2; n <= doc.lines; n++) {
      if (doc.line(n).text === '---') {
        ranges.push([0, doc.line(n).to])
        break
      }
    }
  }

  return ranges
}

function isSkipped(ranges: Array<[number, number]>, from: number, to: number): boolean {
  return ranges.some(([s, e]) => from < e && to > s)
}

/** Every misspelled word in [from,to), in document order. */
function misspelledIn(view: EditorView, from: number, to: number): WordSpan[] {
  const spans: WordSpan[] = []
  if (!isDictionaryReady()) return spans
  const skip = collectSkipRanges(view, from, to)
  const text = view.state.doc.sliceString(from, to)

  WORD_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WORD_RE.exec(text)) != null) {
    const word = m[0]
    if (word.length < 2) continue
    // Skip words with an internal capital (camelCase, PascalCase, acronyms like
    // KNote / GitHub / USA) — technical tokens, not prose typos.
    if (/[A-Z]/.test(word.slice(1))) continue
    const start = from + m.index
    const end = start + word.length
    const before = start > 0 ? view.state.doc.sliceString(start - 1, start) : ''
    const after = end < view.state.doc.length ? view.state.doc.sliceString(end, end + 1) : ''
    if (ADJACENT.test(before) || ADJACENT.test(after)) continue
    if (isSkipped(skip, start, end)) continue
    if (checkWord(word)) continue
    spans.push({ from: start, to: end, word })
  }
  return spans
}

function buildDecorations(view: EditorView): DecorationSet {
  const decorations = []
  for (const { from, to } of view.visibleRanges) {
    for (const span of misspelledIn(view, from, to)) {
      decorations.push(spellMark.range(span.from, span.to))
    }
  }
  return Decoration.set(decorations, true)
}

/** The misspelled word at `pos` (for the right-click menu), or null. */
export function misspelledRangeAt(view: EditorView, pos: number): WordSpan | null {
  const line = view.state.doc.lineAt(pos)
  for (const span of misspelledIn(view, line.from, line.to)) {
    if (pos >= span.from && pos <= span.to) return span
  }
  return null
}

export const spellCheck = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    private appliedWords: string[]
    private unsubscribe: () => void

    constructor(view: EditorView) {
      // Seed the personal dictionary from the current vault config, then keep it
      // in sync as the config store updates (adds via "Add to dictionary", or a
      // configChanged event from the host).
      this.appliedWords = useConfigStore.getState().vaultConfig.userDictionary ?? []
      setPersonalWords(this.appliedWords)
      this.unsubscribe = useConfigStore.subscribe(() => {
        const words = useConfigStore.getState().vaultConfig.userDictionary ?? []
        if (words === this.appliedWords) return
        this.appliedWords = words
        setPersonalWords(words)
        recheckSpelling(view)
      })

      this.decorations = buildDecorations(view)
      // Parse the dictionary off the first paint, then reveal squiggles.
      if (!isDictionaryReady()) void loadDictionary().then(() => recheckSpelling(view))
    }

    update(update: ViewUpdate): void {
      const forced = update.transactions.some((t) => t.effects.some((e) => e.is(recheckEffect)))
      if (update.docChanged || update.viewportChanged || forced) {
        this.decorations = buildDecorations(update.view)
      }
    }

    destroy(): void {
      this.unsubscribe()
    }
  },
  { decorations: (plugin) => plugin.decorations }
)
