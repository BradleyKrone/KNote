// Spell checking for a CodeMirror view — the note editor, the task dialog's
// title field and table cells. A ViewPlugin scans the visible text and
// underlines the words findMisspellings (spellWords.ts) flags with a wavy
// `.cm-spell-error` mark (styled in editor/theme.ts and webview.css). The
// right-click menus use misspelledRangeAt() to offer corrections for the word
// under the cursor.
//
// On top of spellWords' own skips, words inside code, links and the YAML
// frontmatter block are skipped, since those aren't prose and would only
// produce false positives. A view with no markdown grammar (the title field)
// simply has an empty syntax tree.

import { syntaxTree } from '@codemirror/language'
import { StateEffect } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate
} from '@codemirror/view'
import { checkWord, isDictionaryReady, onSpellingChanged } from './dictionary'
import { findMisspellings, type WordSpan } from './spellWords'

export type { WordSpan } from './spellWords'

/** Dispatched to force the plugin to re-scan (dictionary loaded, word ignored/added). */
const recheckEffect = StateEffect.define<null>()

const spellMark = Decoration.mark({ class: 'cm-spell-error' })

// Lezer node types whose text isn't prose.
const SKIP_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'URL', 'Autolink', 'Comment'])

/** Syntax-tree and frontmatter ranges within [from,to) to ignore, relative to `from`. */
function collectSkipRanges(view: EditorView, from: number, to: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const { doc } = view.state

  syntaxTree(view.state).iterate({
    from,
    to,
    enter: (node) => {
      if (SKIP_NODES.has(node.name)) ranges.push([node.from - from, node.to - from])
    }
  })

  // The YAML frontmatter block (`---` … `---` at the very top of the note).
  if (doc.lines >= 1 && doc.line(1).text === '---') {
    for (let n = 2; n <= doc.lines; n++) {
      if (doc.line(n).text === '---') {
        ranges.push([0 - from, doc.line(n).to - from])
        break
      }
    }
  }

  return ranges
}

/** Every misspelled word in [from,to), in document order, with absolute offsets. */
function misspelledIn(view: EditorView, from: number, to: number): WordSpan[] {
  if (!isDictionaryReady()) return []
  const { doc } = view.state
  const spans = findMisspellings(
    doc.sliceString(from, to),
    checkWord,
    collectSkipRanges(view, from, to),
    {
      before: from > 0 ? doc.sliceString(from - 1, from) : '',
      after: to < doc.length ? doc.sliceString(to, to + 1) : ''
    }
  )
  return spans.map((s) => ({ from: s.from + from, to: s.to + from, word: s.word }))
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
    private unsubscribe: () => void

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
      // Re-scan once the dictionary has parsed (it's deferred off first paint)
      // and whenever a word is added to the personal dictionary or ignored.
      this.unsubscribe = onSpellingChanged(() => view.dispatch({ effects: recheckEffect.of(null) }))
    }

    update(update: ViewUpdate): void {
      const forced = update.transactions.some((t) => t.effects.some((e) => e.is(recheckEffect)))
      const treeGrew = syntaxTree(update.startState) !== syntaxTree(update.state)
      if (update.docChanged || update.viewportChanged || forced || treeGrew) {
        this.decorations = buildDecorations(update.view)
      }
    }

    destroy(): void {
      this.unsubscribe()
    }
  },
  { decorations: (plugin) => plugin.decorations }
)
