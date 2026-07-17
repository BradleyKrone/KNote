// Renders GFM pipe tables as real HTML <table> grids in the live-preview
// editor — the one construct where styled raw text can't approach the look of
// VS Code's built-in Markdown preview.
//
// Block widgets and line-crossing replace decorations can't be supplied by a
// ViewPlugin (the view needs them before it lays out content), so this lives
// in a StateField. When the cursor is on any of a table's lines the raw pipes
// are revealed (and styled by CSS) so it stays directly editable — the same
// Obsidian "Live Preview" behavior the rest of the editor uses.

import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { parseTable } from './tableModel'

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

class TableWidget extends WidgetType {
  constructor(private readonly raw: string) {
    super()
  }
  eq(other: TableWidget): boolean {
    return other.raw === this.raw
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-table-wrap'
    wrap.appendChild(buildTable(this.raw))
    // Click the rendered table to drop the cursor into it → reveals the raw
    // pipes for editing (posAtDOM stays correct even after edits move it).
    wrap.addEventListener('mousedown', (e) => {
      const pos = view.posAtDOM(wrap)
      view.dispatch({ selection: { anchor: pos } })
      view.focus()
      e.preventDefault()
    })
    return wrap
  }
}

function buildTable(raw: string): HTMLTableElement {
  const { header, aligns, rows } = parseTable(raw)
  const table = document.createElement('table')
  table.className = 'cm-md-rendered-table'
  if (header.length === 0) return table

  const thead = document.createElement('thead')
  const htr = document.createElement('tr')
  header.forEach((cell, i) => {
    const th = document.createElement('th')
    th.textContent = cell
    if (aligns[i]) th.style.textAlign = aligns[i]
    htr.appendChild(th)
  })
  thead.appendChild(htr)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  for (const cells of rows) {
    const tr = document.createElement('tr')
    cells.forEach((cell, i) => {
      const td = document.createElement('td')
      td.textContent = cell
      if (aligns[i]) td.style.textAlign = aligns[i]
      tr.appendChild(td)
    })
    tbody.appendChild(tr)
  }
  table.appendChild(tbody)
  return table
}

function buildDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const revealed = revealedLines(state)
  const { doc } = state

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return undefined
      const firstNum = doc.lineAt(node.from).number
      const lastNum = doc.lineAt(Math.max(node.from, node.to - 1)).number

      let anyRevealed = false
      for (let n = firstNum; n <= lastNum && !anyRevealed; n++) {
        if (revealed.has(n)) anyRevealed = true
      }

      if (anyRevealed) {
        // Editing: keep the raw pipes, styled monospace so columns align.
        for (let n = firstNum; n <= lastNum; n++) {
          const line = doc.line(n)
          let c = 'cm-md-table-line'
          if (n === firstNum) c += ' cm-md-table-header'
          else if (/^[\s|:-]+$/.test(line.text)) c += ' cm-md-table-delim'
          decorations.push(Decoration.line({ class: c }).range(line.from))
        }
      } else {
        const first = doc.line(firstNum)
        const last = doc.line(lastNum)
        const raw = doc.sliceString(first.from, last.to)
        decorations.push(
          Decoration.replace({ widget: new TableWidget(raw), block: true }).range(
            first.from,
            last.to
          )
        )
      }
      return false // don't descend into cells
    }
  })

  return Decoration.set(decorations, true)
}

export const tableRender = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update(value, tr) {
    if (tr.docChanged || tr.selection) return buildDecorations(tr.state)
    return value.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f)
})
