// Live-preview decorations: render standard markdown inline (headings,
// bold/italic/strike, code, blockquotes, lists, links) by hiding the syntax
// marks and styling the content — except on the line(s) the selection is on,
// where the raw markdown is revealed so it stays directly editable (the
// Obsidian "Live Preview" behavior).
//
// Works off the Lezer markdown syntax tree; KNote-specific constructs
// (checkboxes, wiki-links, tags, embeds) are layered on in knoteConstructs.ts.

import { syntaxTree } from '@codemirror/language'
import type { EditorState, Line, Range, Text } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate
} from '@codemirror/view'
import { isCollapsedMermaidFence } from './mermaidRender'

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

// Heading nodes to a full-line class (enables block spacing + h1/h2 underline).
function headingLineClass(name: string): string | null {
  switch (name) {
    case 'ATXHeading1':
    case 'SetextHeading1':
      return 'cm-md-h1-line'
    case 'ATXHeading2':
    case 'SetextHeading2':
      return 'cm-md-h2-line'
    case 'ATXHeading3':
      return 'cm-md-h3-line'
    case 'ATXHeading4':
      return 'cm-md-h4-line'
    case 'ATXHeading5':
      return 'cm-md-h5-line'
    case 'ATXHeading6':
      return 'cm-md-h6-line'
    default:
      return null
  }
}

/** Run `fn` for each doc line a node [from,to) covers, flagging first/last. */
function eachLine(
  doc: Text,
  from: number,
  to: number,
  fn: (line: Line, first: boolean, last: boolean) => void
): void {
  const firstNum = doc.lineAt(from).number
  const lastNum = doc.lineAt(Math.max(from, to - 1)).number
  for (let n = firstNum; n <= lastNum; n++) {
    fn(doc.line(n), n === firstNum, n === lastNum)
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

/**
 * True when line `n` (1-based) has its raw markdown revealed because the
 * selection touches it. mdLink.ts uses this to leave clicks alone on the line
 * you're editing, where the `(url)` is visible and directly editable.
 */
export function isLineRevealed(state: EditorState, n: number): boolean {
  return state.selection.ranges.some(
    (r) => state.doc.lineAt(r.from).number <= n && n <= state.doc.lineAt(r.to).number
  )
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
        const name = node.name
        // A collapsed mermaid fence is rendered as a diagram widget by
        // mermaidRender.ts — skip content styling for the range it owns, the
        // same way Table nodes are left out of contentClass() entirely.
        const collapsedMermaid = name === 'FencedCode' && isCollapsedMermaidFence(view.state, node)
        const cls = collapsedMermaid ? null : contentClass(name)
        if (cls && node.to > node.from) {
          decorations.push(Decoration.mark({ class: cls }).range(node.from, node.to))
        }

        // Full-line (block) styling — headings, fenced code, blockquotes,
        // tables — so borders/backgrounds/spacing can span the whole line.
        const hLine = headingLineClass(name)
        if (hLine) {
          decorations.push(Decoration.line({ class: hLine }).range(doc.lineAt(node.from).from))
        } else if ((name === 'FencedCode' || name === 'CodeBlock') && !collapsedMermaid) {
          eachLine(doc, node.from, node.to, (line, first, last) => {
            let c = 'cm-md-codeblock-line'
            if (first) c += ' cm-md-codeblock-first'
            if (last) c += ' cm-md-codeblock-last'
            decorations.push(Decoration.line({ class: c }).range(line.from))
          })
        } else if (name === 'Blockquote') {
          eachLine(doc, node.from, node.to, (line) => {
            decorations.push(Decoration.line({ class: 'cm-md-quote-line' }).range(line.from))
          })
        }
        // Tables are rendered separately (tableRender.ts) — as a block widget
        // that can't be provided from a view plugin.

        // A hyperlink's `(url)` is hidden too, so live preview shows just the
        // link text (mdLink.ts makes it clickable). `URL` can't go in HIDE:
        // the same node type sits under `Image` — whose src knoteConstructs
        // needs — and under `Autolink`, where the URL *is* the visible text.
        if (name === 'Link' && !revealed.has(doc.lineAt(node.from).number)) {
          const url = node.node.getChild('URL')
          if (url && url.to > url.from) {
            decorations.push(Decoration.replace({}).range(url.from, url.to))
            // The target is invisible once hidden, so surface it on hover.
            const title = doc.sliceString(url.from, url.to)
            decorations.push(Decoration.mark({ attributes: { title } }).range(node.from, node.to))
          }
        }

        if (HIDE.has(name)) {
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
