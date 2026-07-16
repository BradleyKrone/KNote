// Live-preview decorations: render standard markdown inline (headings,
// bold/italic/strike, code, blockquotes, lists, links) by hiding the syntax
// marks and styling the content — except on the line(s) the selection is on,
// where the raw markdown is revealed so it stays directly editable (the
// Obsidian "Live Preview" behavior).
//
// Works off the Lezer markdown syntax tree; KNote-specific constructs
// (checkboxes, wiki-links, tags, embeds) are layered on in knoteConstructs.ts.

import { syntaxTree } from '@codemirror/language'
import type { Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate
} from '@codemirror/view'

// Syntax-mark nodes to hide (the `#`, `**`, `` ` ``, `>`, `-`, `[`/`]`/`(`/`)`).
const HIDE = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'QuoteMark',
  'LinkMark'
])

// Content nodes to style, mapped to a CSS class (see editor.css).
function contentClass(name: string): string | null {
  switch (name) {
    case 'ATXHeading1':
    case 'SetextHeading1':
      return 'cm-md-h1'
    case 'ATXHeading2':
    case 'SetextHeading2':
      return 'cm-md-h2'
    case 'ATXHeading3':
      return 'cm-md-h3'
    case 'ATXHeading4':
      return 'cm-md-h4'
    case 'ATXHeading5':
      return 'cm-md-h5'
    case 'ATXHeading6':
      return 'cm-md-h6'
    case 'StrongEmphasis':
      return 'cm-md-strong'
    case 'Emphasis':
      return 'cm-md-em'
    case 'Strikethrough':
      return 'cm-md-strike'
    case 'InlineCode':
      return 'cm-md-code'
    case 'FencedCode':
    case 'CodeBlock':
      return 'cm-md-codeblock'
    case 'Blockquote':
      return 'cm-md-quote'
    case 'Link':
      return 'cm-md-link'
    default:
      return null
  }
}

/** Line numbers (1-based) that intersect the selection — raw syntax stays visible there. */
function revealedLines(view: EditorView): Set<number> {
  const lines = new Set<number>()
  for (const r of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(r.from).number
    const last = view.state.doc.lineAt(r.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const revealed = revealedLines(view)
  const { doc } = view.state

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const cls = contentClass(node.name)
        if (cls && node.to > node.from) {
          decorations.push(Decoration.mark({ class: cls }).range(node.from, node.to))
        }
        if (HIDE.has(node.name)) {
          const line = doc.lineAt(node.from).number
          if (revealed.has(line)) return
          let end = node.to
          // Eat the single space after ATX heading hashes and blockquote `>`.
          if (
            (node.name === 'HeaderMark' || node.name === 'QuoteMark') &&
            doc.sliceString(end, end + 1) === ' '
          ) {
            end += 1
          }
          if (end > node.from) decorations.push(Decoration.replace({}).range(node.from, end))
        }
      }
    })
  }
  return Decoration.set(decorations, true)
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
)
