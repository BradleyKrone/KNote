// Spell checking for plain <input>/<textarea> boxes. VS Code turns Chromium's
// own spell checker off for webviews, so the `spellcheck` attribute alone
// draws nothing; KNote paints the squiggles itself.
//
// installInputSpellCheck() is called once per webview (each main.tsx) and
// covers every text box from then on: a box is attached the first time it is
// focused or typed into. Opt a box out with the standard `spellcheck="false"`
// (`spellCheck={false}` in JSX) — search, filter and code-ish fields do.
//
// Each attached box gets an overlay: a transparent copy of its text laid
// exactly over it as its next sibling, with each misspelled word wrapped in a
// `.knote-spell-error` span. The text is invisible and the overlay never takes
// a pointer event, so only the squiggles show and the real field underneath is
// untouched. A right-click on a flagged word opens the shared spell menu
// (SpellMenu.tsx); a correction goes in through execCommand('insertText') so it
// is a real input event — React's onChange sees it and Ctrl+Z undoes it.

import { checkWord, isDictionaryReady, onSpellingChanged } from './dictionary'
import { openSpellMenu } from './SpellMenu'
import { findMisspellings, type WordSpan } from './spellWords'

type Field = HTMLInputElement | HTMLTextAreaElement

interface Attached {
  overlay: HTMLDivElement
  text: HTMLDivElement
  spans: WordSpan[]
  /** The value last rendered, so a reposition doesn't re-tokenize. */
  rendered: string | null
  dispose: () => void
}

const attached = new Map<Field, Attached>()
let installed = false

/** Start spell checking every eligible text box in this webview. Idempotent. */
export function installInputSpellCheck(): void {
  if (installed) return
  installed = true
  const onEvent = (e: Event): void => {
    const el = e.target
    if (isEligible(el)) attach(el)
  }
  document.addEventListener('focusin', onEvent, true)
  document.addEventListener('input', onEvent, true)
  // Drop the overlay of a box that has left the DOM (a closed dialog).
  new MutationObserver(() => {
    for (const [field, a] of attached) if (!field.isConnected) a.dispose()
  }).observe(document.body, { childList: true, subtree: true })
}

function isEligible(el: EventTarget | null): el is Field {
  if (el instanceof HTMLTextAreaElement) return el.getAttribute('spellcheck') !== 'false'
  if (el instanceof HTMLInputElement) {
    return (el.type === 'text' || el.type === 'search') && el.getAttribute('spellcheck') !== 'false'
  }
  return false
}

function attach(field: Field): void {
  const existing = attached.get(field)
  if (existing) {
    sync(field, existing)
    return
  }
  const overlay = document.createElement('div')
  overlay.className = 'knote-spell-overlay'
  overlay.setAttribute('aria-hidden', 'true')
  const text = document.createElement('div')
  text.className = 'knote-spell-overlay-text'
  overlay.appendChild(text)

  const a: Attached = { overlay, text, spans: [], rendered: null, dispose: () => {} }
  const update = (): void => sync(field, a)
  const onScroll = (): void => scrollWith(field, a)
  const onContextMenu = (e: Event): void => openMenuAt(field, a, e as MouseEvent)
  const resize = new ResizeObserver(update)
  resize.observe(field)
  if (field.parentElement) resize.observe(field.parentElement)
  const unsubscribe = onSpellingChanged(() => {
    a.rendered = null
    update()
  })
  field.addEventListener('scroll', onScroll)
  field.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('resize', update)

  a.dispose = () => {
    resize.disconnect()
    unsubscribe()
    field.removeEventListener('scroll', onScroll)
    field.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('resize', update)
    overlay.remove()
    attached.delete(field)
  }
  attached.set(field, a)
  sync(field, a)
}

// Everything that decides where a glyph lands inside the field's box.
const COPIED_STYLES = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontStretch',
  'fontVariant',
  'fontKerning',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'textTransform',
  'textIndent',
  'textAlign',
  'tabSize',
  'direction',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle'
] as const

/** Re-render the overlay's text (if the value changed) and lay it over the field. */
function sync(field: Field, a: Attached): void {
  const { overlay } = a
  if (!field.isConnected) {
    a.dispose()
    return
  }
  // Keep the overlay right after its field, even if the field was moved.
  if (overlay.previousSibling !== field) field.after(overlay)

  const rect = field.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    overlay.style.display = 'none'
    return
  }
  overlay.style.display = ''

  const cs = getComputedStyle(field)
  for (const prop of COPIED_STYLES) overlay.style[prop] = cs[prop]
  const isArea = field instanceof HTMLTextAreaElement
  if (isArea) {
    a.text.style.whiteSpace = 'pre-wrap'
    a.text.style.overflowWrap = 'break-word'
    overlay.style.display = 'block'
    // A vertical scrollbar narrows the text area; narrow the copy to match.
    const bars =
      field.offsetWidth -
      field.clientWidth -
      parseFloat(cs.borderLeftWidth) -
      parseFloat(cs.borderRightWidth)
    overlay.style.paddingRight = `${parseFloat(cs.paddingRight) + Math.max(0, bars)}px`
  } else {
    // An <input> centres its one line vertically in its box.
    a.text.style.whiteSpace = 'pre'
    overlay.style.display = 'flex'
    overlay.style.alignItems = 'center'
  }
  overlay.style.width = `${rect.width}px`
  overlay.style.height = `${rect.height}px`

  // Place it by measuring rather than trusting offsetLeft/Top: whatever the
  // overlay's containing block turns out to be, this lands it on the field.
  overlay.style.left = '0px'
  overlay.style.top = '0px'
  const origin = overlay.getBoundingClientRect()
  overlay.style.left = `${rect.left - origin.left}px`
  overlay.style.top = `${rect.top - origin.top}px`

  render(field, a)
  scrollWith(field, a)
}

function render(field: Field, a: Attached): void {
  const value = field.value
  if (value === a.rendered) return
  a.rendered = value
  a.spans = isDictionaryReady() ? findMisspellings(value, checkWord) : []
  const frag = document.createDocumentFragment()
  let at = 0
  for (const span of a.spans) {
    frag.append(value.slice(at, span.from))
    const mark = document.createElement('span')
    mark.className = 'knote-spell-error'
    mark.textContent = span.word
    frag.append(mark)
    at = span.to
  }
  // A trailing newline in a textarea still takes a line; a bare one here wouldn't.
  frag.append(value.slice(at) + (value.endsWith('\n') ? ' ' : ''))
  a.text.replaceChildren(frag)
}

function scrollWith(field: Field, a: Attached): void {
  a.text.style.transform = `translate(${-field.scrollLeft}px, ${-field.scrollTop}px)`
}

/** Right-click: if it landed on a squiggled word, offer corrections. */
function openMenuAt(field: Field, a: Attached, e: MouseEvent): void {
  sync(field, a)
  const marks = a.text.querySelectorAll('.knote-spell-error')
  for (let i = 0; i < marks.length; i++) {
    const hit = [...marks[i].getClientRects()].some(
      (r) =>
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    )
    if (!hit) continue
    const span = a.spans[i]
    e.preventDefault()
    openSpellMenu({
      x: e.clientX,
      y: e.clientY,
      word: span.word,
      replace: (s) => replaceIn(field, span, s)
    })
    return
  }
}

function replaceIn(field: Field, span: WordSpan, replacement: string): void {
  // The box may have been edited while the menu was open — only replace the
  // word if it is still exactly where it was.
  if (field.value.slice(span.from, span.to) !== span.word) return
  field.focus()
  field.setSelectionRange(span.from, span.to)
  if (!document.execCommand('insertText', false, replacement)) {
    field.setRangeText(replacement, span.from, span.to, 'end')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
}
