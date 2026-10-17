// Drag-to-reorder for list items in the live-preview editor.
//
// Hovering any list line (bullet, numbered, checkbox, `@task`) reveals a ⋮⋮
// grip to its left; dragging it moves the *whole item* — the line plus every
// more-indented line under it, the same block a fold hides — to another slot
// among its siblings. Alt+↑/↓ does the same from the keyboard. Position is
// the priority: nothing is written onto the line, the item simply moves, and
// since the board orders cards by file position it follows along for free.
//
// Drops are limited to siblings (same indent, same parent list) so a drag can
// only *reorder* — re-parenting stays a Tab/Shift-Tab job, and a drop can never
// splice an item into the middle of another one's block.
//
// Every move is a single replace over the affected span, so outboundSync sends
// it to the host as one edit and VS Code undoes it in one step.

import { Prec, type EditorState, type StateCommand, type TransactionSpec } from '@codemirror/state'
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { foldEffect, foldedRanges } from '@codemirror/language'
import { LIST_ITEM_RE } from '@shared/parser/patterns'
import { indentColumns, lastChildLine } from './taskFold'

/** A list item's line span, 1-based and inclusive. */
export interface ItemBlock {
  first: number
  last: number
}

/**
 * Every item in the list `lineNum` belongs to — same indent, same parent — in
 * document order, each with its block. Empty when `lineNum` isn't a list item.
 * The run ends at a shallower line (the parent, or the end of a nested list)
 * or at a same-indent line that isn't a list item (a heading, a paragraph).
 */
export function siblingItems(state: EditorState, lineNum: number): ItemBlock[] {
  const doc = state.doc
  const text = doc.line(lineNum).text
  if (!LIST_ITEM_RE.test(text)) return []
  const indent = indentColumns(text)

  // Same-indent list lines in the run; deeper lines are some sibling's children.
  const isSibling = (n: number): boolean | null => {
    const t = doc.line(n).text
    if (t.trim() === '') return false
    const ind = indentColumns(t)
    if (ind > indent) return false
    if (ind === indent && LIST_ITEM_RE.test(t)) return true
    return null // run ends here
  }

  const firsts: number[] = [lineNum]
  for (let n = lineNum - 1; n >= 1; n--) {
    const s = isSibling(n)
    if (s === null) break
    if (s) firsts.unshift(n)
  }
  for (let n = lineNum + 1; n <= doc.lines; n++) {
    const s = isSibling(n)
    if (s === null) break
    if (s) firsts.push(n)
  }
  return firsts.map((first) => ({ first, last: lastChildLine(state, first) }))
}

/**
 * The transaction that moves `siblings[from]` to `slot` — the gap before
 * `siblings[slot]`, or after the last item when `slot === siblings.length`.
 * Null when that's where it already is.
 *
 * Only the items between the old and new position are rewritten, as one
 * replace. The text *between* items (blank lines in a loose list) stays where
 * it was, so moving an item never shifts the list's spacing around. Folds
 * inside any rewritten item are carried to its new position — a replace would
 * otherwise drop them, and a folded item would spring open as it moved.
 */
export function moveItem(
  state: EditorState,
  siblings: ItemBlock[],
  from: number,
  slot: number,
  userEvent = 'move.line'
): TransactionSpec | null {
  const to = slot > from ? slot - 1 : slot
  if (to === from || to < 0 || to >= siblings.length) return null
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)

  const order = siblings.map((_, i) => i)
  order.splice(from, 1)
  order.splice(to, 0, from)

  const doc = state.doc
  const start = (i: number) => doc.line(siblings[i].first).from
  const end = (i: number) => doc.line(siblings[i].last).to

  let insert = ''
  const newStart = new Map<number, number>()
  const spanFrom = start(lo)
  for (let k = lo; k <= hi; k++) {
    const i = order[k]
    newStart.set(i, spanFrom + insert.length)
    insert += doc.sliceString(start(i), end(i))
    if (k < hi) insert += doc.sliceString(end(k), start(k + 1)) // the gap stays put
  }
  const spanTo = end(hi)

  const effects: ReturnType<typeof foldEffect.of>[] = []
  foldedRanges(state).between(spanFrom, spanTo, (f, t) => {
    for (let i = lo; i <= hi; i++) {
      if (f >= start(i) && t <= end(i)) {
        const delta = newStart.get(i)! - start(i)
        effects.push(foldEffect.of({ from: f + delta, to: t + delta }))
        return
      }
    }
  })

  // A cursor inside the moved item rides along with it; anywhere else it's
  // left to the ordinary change mapping.
  const head = state.selection.main.head
  const inMoved = head >= start(from) && head <= end(from)
  return {
    changes: { from: spanFrom, to: spanTo, insert },
    ...(inMoved ? { selection: { anchor: head - start(from) + newStart.get(from)! } } : {}),
    effects,
    userEvent,
    scrollIntoView: inMoved
  }
}

function moveByKey(dir: -1 | 1): StateCommand {
  return ({ state, dispatch }) => {
    const sel = state.selection
    if (sel.ranges.length > 1) return false
    const line = state.doc.lineAt(sel.main.head)
    if (state.doc.lineAt(sel.main.anchor).number !== line.number) return false
    const siblings = siblingItems(state, line.number)
    const idx = siblings.findIndex((s) => s.first === line.number)
    if (idx < 0) return false
    // At the end of its list the item stays put — the key is still consumed,
    // since the default moveLine would leave its children behind.
    const spec = moveItem(state, siblings, idx, dir < 0 ? idx - 1 : idx + 2)
    if (spec) dispatch(state.update(spec))
    return true
  }
}

/** Alt+↑ on a list line: swap the whole item with its previous sibling. */
export const moveItemUp = moveByKey(-1)
/** Alt+↓ on a list line: swap the whole item with its next sibling. */
export const moveItemDown = moveByKey(1)

// ---------------------------------------------------------------------------
// The grip and the drag gesture
// ---------------------------------------------------------------------------

interface DragState {
  pointerId: number
  siblings: ItemBlock[]
  from: number
  slot: number | null
}

/** Pixels from the scroller's top/bottom edge where a drag starts scrolling. */
const AUTO_SCROLL_EDGE = 32

class ListDragView {
  private grip: HTMLElement
  private indicator: HTMLElement
  private source: HTMLElement
  private hoverLine: number | null = null
  private drag: DragState | null = null

  constructor(private view: EditorView) {
    this.grip = this.el('cm-knote-drag-grip')
    // Six solid dots (2×3) — the text glyph `⋮⋮` rendered too small and faint
    // to spot beside a bullet.
    this.grip.innerHTML =
      '<svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor">' +
      '<circle cx="2.5" cy="3" r="1.6"/><circle cx="7.5" cy="3" r="1.6"/>' +
      '<circle cx="2.5" cy="8" r="1.6"/><circle cx="7.5" cy="8" r="1.6"/>' +
      '<circle cx="2.5" cy="13" r="1.6"/><circle cx="7.5" cy="13" r="1.6"/></svg>'
    this.grip.title = 'Drag to reorder (Alt+↑/↓)'
    this.indicator = this.el('cm-knote-drag-indicator')
    this.source = this.el('cm-knote-drag-source')

    view.contentDOM.addEventListener('mousemove', this.onHover)
    view.dom.addEventListener('mouseleave', this.onLeave)
    view.scrollDOM.addEventListener('scroll', this.onScroll)
    // Keep the editor's focus and selection when the grip is pressed.
    this.grip.addEventListener('mousedown', (e) => e.preventDefault())
    this.grip.addEventListener('pointerdown', this.onDown)
    this.grip.addEventListener('pointermove', this.onMove)
    this.grip.addEventListener('pointerup', this.onUp)
    this.grip.addEventListener('pointercancel', this.cancel)
    this.grip.addEventListener('lostpointercapture', this.cancel)
  }

  private el(cls: string): HTMLElement {
    const el = document.createElement('div')
    el.className = cls
    el.setAttribute('aria-hidden', 'true')
    el.style.display = 'none'
    this.view.dom.appendChild(el)
    return el
  }

  update(update: ViewUpdate): void {
    // Anything that moves text under the grip makes its line (or a drag's
    // sibling list) stale — an edit from the host mid-drag included.
    if (update.docChanged) {
      this.cancel()
      this.hideGrip()
    } else if (update.geometryChanged && !this.drag) {
      this.hideGrip()
    }
  }

  destroy(): void {
    this.view.contentDOM.removeEventListener('mousemove', this.onHover)
    this.view.dom.removeEventListener('mouseleave', this.onLeave)
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
    window.removeEventListener('keydown', this.onKey, true)
    this.grip.remove()
    this.indicator.remove()
    this.source.remove()
  }

  // --- hover ---------------------------------------------------------------

  private onHover = (e: MouseEvent): void => {
    if (this.drag) return
    const view = this.view
    const block = view.lineBlockAtHeight(e.clientY - view.documentTop)
    const line = view.state.doc.lineAt(block.from)
    const m = LIST_ITEM_RE.exec(line.text)
    if (!m) return this.hideGrip()
    if (this.hoverLine === line.number && this.grip.style.display !== 'none') return
    const coords = view.coordsAtPos(line.from + m[1].length, 1) ?? view.coordsAtPos(line.from, 1)
    if (!coords) return this.hideGrip()
    const box = view.dom.getBoundingClientRect()
    this.hoverLine = line.number
    this.grip.style.display = ''
    this.grip.style.left = `${coords.left - box.left}px`
    this.grip.style.top = `${(coords.top + coords.bottom) / 2 - box.top}px`
  }

  private onLeave = (): void => {
    if (!this.drag) this.hideGrip()
  }

  private onScroll = (): void => {
    if (!this.drag) this.hideGrip()
  }

  private hideGrip(): void {
    this.grip.style.display = 'none'
    this.hoverLine = null
  }

  // --- drag ----------------------------------------------------------------

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.hoverLine === null) return
    e.preventDefault()
    const state = this.view.state
    const siblings = siblingItems(state, this.hoverLine)
    const from = siblings.findIndex((s) => s.first === this.hoverLine)
    if (from < 0) return
    this.drag = { pointerId: e.pointerId, siblings, from, slot: null }
    this.grip.setPointerCapture(e.pointerId)
    this.view.dom.classList.add('cm-knote-list-dragging')
    window.addEventListener('keydown', this.onKey, true)
    this.placeBox(this.source, siblings[from])
  }

  private onMove = (e: PointerEvent): void => {
    const drag = this.drag
    if (!drag || e.pointerId !== drag.pointerId) return
    this.autoScroll(e.clientY)
    const { siblings, from } = drag
    let slot = 0
    for (const s of siblings) {
      if ((this.topOf(s) + this.bottomOf(s)) / 2 < e.clientY) slot++
    }
    if (slot === from || slot === from + 1) {
      drag.slot = null
      this.indicator.style.display = 'none'
      return
    }
    drag.slot = slot
    const y =
      slot === 0
        ? this.topOf(siblings[0])
        : slot === siblings.length
          ? this.bottomOf(siblings[slot - 1])
          : (this.bottomOf(siblings[slot - 1]) + this.topOf(siblings[slot])) / 2
    const box = this.view.dom.getBoundingClientRect()
    const content = this.view.contentDOM.getBoundingClientRect()
    const left = parseFloat(this.grip.style.left)
    this.indicator.style.display = ''
    this.indicator.style.top = `${y - box.top}px`
    this.indicator.style.left = `${left}px`
    this.indicator.style.width = `${Math.max(40, content.right - box.left - left - 16)}px`
    this.placeBox(this.source, siblings[from])
  }

  private onUp = (e: PointerEvent): void => {
    const drag = this.drag
    if (!drag || e.pointerId !== drag.pointerId) return
    const spec =
      drag.slot === null
        ? null
        : moveItem(this.view.state, drag.siblings, drag.from, drag.slot, 'move.drop')
    this.cancel()
    if (spec) this.view.dispatch(spec)
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.drag) return
    e.preventDefault()
    e.stopPropagation()
    this.cancel()
  }

  /** Ends a drag (if any) without moving anything. */
  private cancel = (): void => {
    const drag = this.drag
    if (!drag) return
    this.drag = null
    if (this.grip.hasPointerCapture(drag.pointerId)) this.grip.releasePointerCapture(drag.pointerId)
    window.removeEventListener('keydown', this.onKey, true)
    this.view.dom.classList.remove('cm-knote-list-dragging')
    this.indicator.style.display = 'none'
    this.source.style.display = 'none'
  }

  private autoScroll(y: number): void {
    const r = this.view.scrollDOM.getBoundingClientRect()
    if (y < r.top + AUTO_SCROLL_EDGE) this.view.scrollDOM.scrollTop -= 12
    else if (y > r.bottom - AUTO_SCROLL_EDGE) this.view.scrollDOM.scrollTop += 12
  }

  /** Client-space top of an item's first visual line. */
  private topOf(s: ItemBlock): number {
    return this.view.lineBlockAt(this.view.state.doc.line(s.first).from).top + this.view.documentTop
  }

  /** Client-space bottom of an item's last visual line (a folded block's one line). */
  private bottomOf(s: ItemBlock): number {
    return (
      this.view.lineBlockAt(this.view.state.doc.line(s.last).from).bottom + this.view.documentTop
    )
  }

  private placeBox(el: HTMLElement, s: ItemBlock): void {
    const box = this.view.dom.getBoundingClientRect()
    const content = this.view.contentDOM.getBoundingClientRect()
    const left = parseFloat(this.grip.style.left)
    el.style.display = ''
    el.style.top = `${this.topOf(s) - box.top}px`
    el.style.height = `${this.bottomOf(s) - this.topOf(s)}px`
    el.style.left = `${left}px`
    el.style.width = `${Math.max(40, content.right - box.left - left - 16)}px`
  }
}

const listDragPlugin = ViewPlugin.fromClass(ListDragView)

/** The hover grip + drag gesture, and Alt+↑/↓ whole-item moves. */
export const listDrag = [
  listDragPlugin,
  // Must beat defaultKeymap's moveLineUp/moveLineDown on list lines; on any
  // other line these return false and the default line move runs.
  Prec.highest(
    keymap.of([
      { key: 'Alt-ArrowUp', run: moveItemUp },
      { key: 'Alt-ArrowDown', run: moveItemDown }
    ])
  )
]
