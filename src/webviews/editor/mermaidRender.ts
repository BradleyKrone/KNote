// Renders ```mermaid fenced code blocks as real diagrams in the live-preview
// editor — the Mermaid analog of tableRender.ts's GFM table rendering.
//
// Block widgets and line-crossing replace decorations can't be supplied by a
// ViewPlugin (the view needs them before it lays out content), so this lives
// in a StateField, same as tableRender.ts. When the cursor is on any of a
// block's lines the raw fenced source is left in place (styled by
// livePreview.ts like any other code block) so it stays directly editable.

import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { isMermaidFence, parseFence } from './mermaidModel'

/** Doc line numbers (1-based) that intersect the selection. */
function revealedLines(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number
    const last = state.doc.lineAt(r.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

// mermaid.render() requires a caller-supplied unique id per call.
let nextRenderId = 0

// The mermaid package is sizable, so it's imported dynamically and
// initialized lazily, only the first time a diagram is actually rendered.
let mermaidModule: Promise<typeof import('mermaid')> | null = null
function loadMermaid(): Promise<typeof import('mermaid')> {
  if (!mermaidModule) {
    mermaidModule = import('mermaid').then((mod) => {
      const isDark = document.body.classList.contains('vscode-dark')
      mod.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: isDark ? 'dark' : 'default'
      })
      return mod
    })
  }
  return mermaidModule
}

async function renderInto(wrap: HTMLElement, code: string): Promise<void> {
  try {
    const { default: mermaid } = await loadMermaid()
    const id = `knote-mermaid-${nextRenderId++}`
    const { svg, bindFunctions } = await mermaid.render(id, code)
    wrap.classList.remove('cm-md-mermaid-loading')
    wrap.innerHTML = svg
    bindFunctions?.(wrap)
  } catch (err) {
    wrap.classList.remove('cm-md-mermaid-loading')
    wrap.classList.add('cm-md-mermaid-error')
    wrap.textContent = err instanceof Error ? err.message : String(err)
  }
}

class MermaidWidget extends WidgetType {
  constructor(private readonly code: string) {
    super()
  }
  eq(other: MermaidWidget): boolean {
    return other.code === this.code
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-mermaid-wrap cm-md-mermaid-loading'
    // Click the rendered diagram to drop the cursor into it → reveals the raw
    // fenced source for editing (posAtDOM stays correct even after edits move it).
    wrap.addEventListener('mousedown', (e) => {
      const pos = view.posAtDOM(wrap)
      view.dispatch({ selection: { anchor: pos } })
      view.focus()
      e.preventDefault()
    })
    void renderInto(wrap, this.code)
    return wrap
  }
}

/**
 * True when `node` is a mermaid fence whose lines are all outside the
 * selection — i.e. it's currently shown collapsed as a rendered diagram
 * widget rather than raw text. Exported so livePreview.ts and
 * knoteConstructs.ts can skip their own line/inline decorations for exactly
 * the lines this field's widget owns — the same hazard `inTable()` in
 * knoteConstructs.ts already guards against for GFM tables.
 */
export function isCollapsedMermaidFence(
  state: EditorState,
  node: { from: number; to: number }
): boolean {
  const raw = state.doc.sliceString(node.from, node.to)
  if (!isMermaidFence(raw)) return false
  const revealed = revealedLines(state)
  const firstNum = state.doc.lineAt(node.from).number
  const lastNum = state.doc.lineAt(Math.max(node.from, node.to - 1)).number
  for (let n = firstNum; n <= lastNum; n++) {
    if (revealed.has(n)) return false
  }
  return true
}

function buildDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const { doc } = state

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return undefined
      if (isCollapsedMermaidFence(state, node)) {
        const firstNum = doc.lineAt(node.from).number
        const lastNum = doc.lineAt(Math.max(node.from, node.to - 1)).number
        const first = doc.line(firstNum)
        const last = doc.line(lastNum)
        const { body } = parseFence(doc.sliceString(node.from, node.to))
        decorations.push(
          Decoration.replace({ widget: new MermaidWidget(body), block: true }).range(
            first.from,
            last.to
          )
        )
      }
      return false // don't descend into the fence's own mark/info/text nodes
    }
  })

  return Decoration.set(decorations, true)
}

export const mermaidRender = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update(value, tr) {
    if (tr.docChanged || tr.selection) return buildDecorations(tr.state)
    return value.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f)
})
