// VS Code–style find/replace widget for the Live Preview editor.
//
// CodeMirror's search *engine* is kept as-is — query state, match
// highlighting, findNext/replaceAll — and only its panel is swapped, through
// the `createPanel` hook `search()` exposes. The stock panel is an unstyled
// bar of text buttons and checkboxes docked under the note; this one floats
// at the top right like VS Code's: ▸ replace toggle, an input with Aa / ab /
// .* toggles inside it, a "3 of 12" count, ↑ ↓ ✕, and a replace row that
// stays hidden until asked for. The count lives in findWidgetLogic.ts.

import type { Extension } from '@codemirror/state'
import { EditorView, keymap, runScopeHandlers, type Panel, type ViewUpdate } from '@codemirror/view'
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  setSearchQuery
} from '@codemirror/search'
import { countMatches, formatCount } from './findWidgetLogic'

// Inline SVGs (16×16, currentColor) — nothing loaded from anywhere.
const svg = (body: string): string =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
  `stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const ICONS = {
  chevron: svg('<path d="M6 4l4 4-4 4"/>'),
  up: svg('<path d="M8 13V3.5M3.5 8L8 3.5 12.5 8"/>'),
  down: svg('<path d="M8 3v9.5M3.5 8L8 12.5 12.5 8"/>'),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  replace: svg(
    '<path d="M2.5 6.5V4.5a1.5 1.5 0 0 1 1.5-1.5h5M7.5 1.5L9 3 7.5 4.5"/>' +
      '<rect x="6" y="8" width="7.5" height="5.5" rx="1"/>'
  ),
  replaceAll: svg(
    '<path d="M1.5 6V4a1.5 1.5 0 0 1 1.5-1.5h4M5.5 1L7 2.5 5.5 4"/>' +
      '<rect x="4.5" y="6.5" width="7" height="4.5" rx="1"/>' +
      '<path d="M7 13.5h6a1 1 0 0 0 1-1V9"/>'
  )
}

type QueryOption = 'caseSensitive' | 'wholeWord' | 'regexp'

/** The open widget for each view, so Ctrl+H can expand the replace row. */
const panels = new WeakMap<EditorView, FindPanel>()

function iconButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'cm-knote-find-btn'
  b.title = title
  b.setAttribute('aria-label', title)
  b.innerHTML = icon
  // Keep focus where it is (the input, usually) — clicking ↓ shouldn't
  // pull the caret out of the find field, any more than it does in VS Code.
  b.addEventListener('mousedown', (e) => e.preventDefault())
  b.addEventListener('click', onClick)
  return b
}

function toggleButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = iconButton('', title, onClick)
  b.classList.add('cm-knote-find-toggle')
  b.textContent = label
  b.setAttribute('aria-pressed', 'false')
  return b
}

function setPressed(b: HTMLButtonElement, on: boolean): void {
  b.classList.toggle('cm-knote-find-on', on)
  b.setAttribute('aria-pressed', String(on))
}

class FindPanel implements Panel {
  readonly dom: HTMLElement
  readonly top = true
  private query: SearchQuery
  private readonly findField: HTMLInputElement
  private readonly replaceField: HTMLInputElement
  private readonly findBox: HTMLElement
  private readonly countEl: HTMLElement
  private readonly caseBtn: HTMLButtonElement
  private readonly wordBtn: HTMLButtonElement
  private readonly regexBtn: HTMLButtonElement
  private readonly expandBtn: HTMLButtonElement
  private readonly navBtns: HTMLButtonElement[]
  private readonly replaceBtns: HTMLButtonElement[]

  constructor(private readonly view: EditorView) {
    this.query = getSearchQuery(view.state)

    this.findField = document.createElement('input')
    this.findField.className = 'cm-knote-find-field'
    this.findField.placeholder = 'Find'
    this.findField.setAttribute('aria-label', 'Find')
    // openSearchPanel focuses/selects whatever carries this when Ctrl+F is
    // pressed again with the widget already open.
    this.findField.setAttribute('main-field', 'true')
    this.findField.addEventListener('input', () => this.commit(true))
    this.findField.addEventListener('keydown', (e) => this.findKey(e))

    this.caseBtn = toggleButton('Aa', 'Match Case (Alt+C)', () => this.flip('caseSensitive'))
    this.wordBtn = toggleButton('ab', 'Match Whole Word (Alt+W)', () => this.flip('wholeWord'))
    this.wordBtn.classList.add('cm-knote-find-word')
    this.regexBtn = toggleButton('.*', 'Use Regular Expression (Alt+R)', () => this.flip('regexp'))

    this.findBox = document.createElement('div')
    this.findBox.className = 'cm-knote-find-box'
    this.findBox.append(this.findField, this.caseBtn, this.wordBtn, this.regexBtn)

    this.countEl = document.createElement('div')
    this.countEl.className = 'cm-knote-find-count'

    this.navBtns = [
      iconButton(ICONS.up, 'Previous Match (Shift+Enter)', () => findPrevious(view)),
      iconButton(ICONS.down, 'Next Match (Enter)', () => findNext(view))
    ]
    const closeBtn = iconButton(ICONS.close, 'Close (Escape)', () => closeSearchPanel(view))

    const findRow = document.createElement('div')
    findRow.className = 'cm-knote-find-row'
    findRow.append(this.findBox, this.countEl, ...this.navBtns, closeBtn)

    this.replaceField = document.createElement('input')
    this.replaceField.className = 'cm-knote-find-field'
    this.replaceField.placeholder = 'Replace'
    this.replaceField.setAttribute('aria-label', 'Replace')
    this.replaceField.addEventListener('input', () => this.commit(false))
    this.replaceField.addEventListener('keydown', (e) => this.replaceKey(e))

    const replaceBox = document.createElement('div')
    replaceBox.className = 'cm-knote-find-box'
    replaceBox.append(this.replaceField)

    this.replaceBtns = [
      iconButton(ICONS.replace, 'Replace (Enter)', () => replaceNext(view)),
      iconButton(ICONS.replaceAll, 'Replace All (Ctrl+Alt+Enter)', () => replaceAll(view))
    ]
    const replaceRow = document.createElement('div')
    replaceRow.className = 'cm-knote-find-row cm-knote-find-replace-row'
    replaceRow.append(replaceBox, ...this.replaceBtns)

    this.expandBtn = iconButton(ICONS.chevron, 'Toggle Replace', () =>
      this.setReplaceOpen(!this.dom.classList.contains('cm-knote-find-replacing'))
    )
    this.expandBtn.classList.add('cm-knote-find-expand')

    const rows = document.createElement('div')
    rows.className = 'cm-knote-find-rows'
    rows.append(findRow, replaceRow)

    this.dom = document.createElement('div')
    this.dom.className = 'cm-knote-find'
    this.dom.append(this.expandBtn, rows)
    this.dom.addEventListener('keydown', (e) => this.panelKey(e))

    this.syncFields()
    this.refreshCount()
    panels.set(view, this)
  }

  mount(): void {
    this.findField.focus()
    this.findField.select()
  }

  destroy(): void {
    panels.delete(this.view)
  }

  update(update: ViewUpdate): void {
    let queryChanged = false
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.query = effect.value
          queryChanged = true
        }
      }
    }
    if (queryChanged) this.syncFields()
    if (queryChanged || update.docChanged || update.selectionSet) this.refreshCount()
  }

  setReplaceOpen(open: boolean, focus = false): void {
    this.dom.classList.toggle('cm-knote-find-replacing', open)
    this.expandBtn.setAttribute('aria-expanded', String(open))
    if (focus) (open ? this.replaceField : this.findField).focus()
  }

  private syncFields(): void {
    const q = this.query
    if (this.findField.value !== q.search) this.findField.value = q.search
    if (this.replaceField.value !== q.replace) this.replaceField.value = q.replace
    setPressed(this.caseBtn, q.caseSensitive)
    setPressed(this.wordBtn, q.wholeWord)
    setPressed(this.regexBtn, q.regexp)
  }

  private refreshCount(): void {
    const count = countMatches(this.view.state, this.query)
    const empty = this.query.search !== '' && count.total === 0
    this.countEl.textContent = formatCount(this.query, count)
    this.countEl.classList.toggle('cm-knote-find-none', empty)
    this.findBox.classList.toggle('cm-knote-find-none', empty)
    for (const b of this.navBtns) b.disabled = count.total === 0
    for (const b of this.replaceBtns) b.disabled = count.total === 0
  }

  /** Push the fields into the search state. `seek`: jump to the nearest match, as VS Code does while typing. */
  private commit(seek: boolean, overrides: Partial<Record<QueryOption, boolean>> = {}): void {
    const query = new SearchQuery({
      search: this.findField.value,
      replace: this.replaceField.value,
      caseSensitive: this.query.caseSensitive,
      wholeWord: this.query.wholeWord,
      regexp: this.query.regexp,
      literal: this.query.literal,
      ...overrides
    })
    if (query.eq(this.query)) return
    this.query = query
    this.syncFields()
    this.view.dispatch({ effects: setSearchQuery.of(query) })
    if (seek) this.seekFrom(this.view.state.selection.main.from)
  }

  private flip(option: QueryOption): void {
    this.commit(true, { [option]: !this.query[option] })
  }

  /** Select the first match at or after `pos`, wrapping to the top; leaves the selection alone when there's none. */
  private seekFrom(pos: number): void {
    if (!this.query.valid) return
    const state = this.view.state
    let match = this.query.getCursor(state, pos).next()
    if (match.done) match = this.query.getCursor(state, 0, pos).next()
    if (match.done) return
    const { from, to } = match.value
    const sel = state.selection.main
    if (sel.from === from && sel.to === to) return
    this.view.dispatch({
      selection: { anchor: from, head: to },
      scrollIntoView: true,
      userEvent: 'select.search'
    })
  }

  private findKey(e: KeyboardEvent): void {
    if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.metaKey) return
    e.preventDefault()
    ;(e.shiftKey ? findPrevious : findNext)(this.view)
  }

  private replaceKey(e: KeyboardEvent): void {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if ((e.ctrlKey || e.metaKey) && e.altKey) replaceAll(this.view)
    else if (!e.ctrlKey && !e.altKey && !e.metaKey) replaceNext(this.view)
  }

  private panelKey(e: KeyboardEvent): void {
    if (e.defaultPrevented) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeSearchPanel(this.view)
      return
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const option = ({ c: 'caseSensitive', w: 'wholeWord', r: 'regexp' } as const)[
        e.key.toLowerCase() as 'c' | 'w' | 'r'
      ]
      if (option) {
        e.preventDefault()
        this.flip(option)
        return
      }
    }
    // searchKeymap's panel-scoped bindings — F3 / Shift+F3, Mod-g, …
    if (runScopeHandlers(this.view, e, 'search-panel')) e.preventDefault()
  }
}

/** Ctrl+H — open the widget with the replace row expanded and focused. */
function openReplace(view: EditorView): boolean {
  openSearchPanel(view)
  panels.get(view)?.setReplaceOpen(true, true)
  return true
}

const findTheme = EditorView.theme({
  // The panels strip itself goes invisible and takes no height; the widget
  // floats over the text from inside it, so opening find never shifts the note.
  '&.cm-editor .cm-panels.cm-panels-top': {
    backgroundColor: 'transparent',
    color: 'inherit',
    borderBottom: 'none'
  },
  '.cm-knote-find': {
    position: 'absolute',
    top: '0',
    right: '18px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '2px',
    padding: '4px 4px 4px 2px',
    maxWidth: 'calc(100% - 36px)',
    boxSizing: 'border-box',
    background: 'var(--vscode-editorWidget-background)',
    color: 'var(--vscode-editorWidget-foreground, var(--vscode-foreground))',
    border: '1px solid var(--vscode-editorWidget-border, transparent)',
    borderTop: 'none',
    borderRadius: '0 0 4px 4px',
    boxShadow: '0 0 8px 2px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36))',
    fontFamily: 'var(--vscode-font-family)',
    fontSize: '13px'
  },
  '.cm-knote-find-rows': {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: '0'
  },
  '.cm-knote-find-row': {
    display: 'flex',
    alignItems: 'center',
    gap: '2px'
  },
  '.cm-knote-find-replace-row': { display: 'none' },
  '.cm-knote-find-replacing .cm-knote-find-replace-row': { display: 'flex' },
  '.cm-knote-find-box': {
    display: 'flex',
    alignItems: 'center',
    width: '230px',
    minWidth: '0',
    flexShrink: '1',
    height: '24px',
    boxSizing: 'border-box',
    padding: '0 2px 0 0',
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border, transparent)',
    borderRadius: '2px'
  },
  '.cm-knote-find-box:focus-within': {
    borderColor: 'var(--vscode-focusBorder)'
  },
  '.cm-knote-find-box.cm-knote-find-none': {
    borderColor: 'var(--vscode-inputValidation-errorBorder, #be1100)'
  },
  '.cm-knote-find-field': {
    flex: '1',
    minWidth: '0',
    height: '100%',
    padding: '0 4px',
    background: 'transparent',
    color: 'inherit',
    border: 'none',
    outline: 'none',
    font: 'inherit'
  },
  '.cm-knote-find-field::placeholder': {
    color: 'var(--vscode-input-placeholderForeground)'
  },
  '.cm-knote-find-btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: '0',
    width: '22px',
    height: '22px',
    padding: '0',
    margin: '0',
    background: 'transparent',
    color: 'inherit',
    border: '1px solid transparent',
    borderRadius: '3px',
    cursor: 'pointer',
    font: 'inherit'
  },
  '.cm-knote-find-btn:hover:not(:disabled)': {
    background: 'var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31))'
  },
  '.cm-knote-find-btn:disabled': { opacity: '0.4', cursor: 'default' },
  '.cm-knote-find-btn:focus-visible': {
    outline: '1px solid var(--vscode-focusBorder)',
    outlineOffset: '-1px'
  },
  '.cm-knote-find-toggle': {
    width: '20px',
    height: '18px',
    fontSize: '11px',
    lineHeight: '1',
    letterSpacing: '-0.5px'
  },
  '.cm-knote-find-word': { textDecoration: 'underline', textUnderlineOffset: '2px' },
  '.cm-knote-find-toggle.cm-knote-find-on': {
    background: 'var(--vscode-inputOption-activeBackground, rgba(0, 127, 212, 0.4))',
    borderColor: 'var(--vscode-inputOption-activeBorder, #007acc)',
    color: 'var(--vscode-inputOption-activeForeground, inherit)'
  },
  '.cm-knote-find-expand': { height: '24px', width: '18px', alignSelf: 'stretch' },
  '.cm-knote-find-expand svg': { transition: 'transform 0.1s' },
  '.cm-knote-find-replacing .cm-knote-find-expand svg': { transform: 'rotate(90deg)' },
  '.cm-knote-find-count': {
    minWidth: '68px',
    padding: '0 4px',
    fontSize: '12px',
    whiteSpace: 'nowrap'
  },
  '.cm-knote-find-count.cm-knote-find-none': {
    color: 'var(--vscode-errorForeground)'
  },
  // VS Code's own find-match colors, so hits look like they do in a text editor.
  '&.cm-editor .cm-searchMatch': {
    backgroundColor: 'var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.33))',
    outline: '1px solid var(--vscode-editor-findMatchHighlightBorder, transparent)'
  },
  '&.cm-editor .cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--vscode-editor-findMatchBackground, #515c6a)',
    outline: '1px solid var(--vscode-editor-findMatchBorder, transparent)'
  }
})

/** Replaces a bare `search()` — the same engine, with the VS Code–style panel. */
export const findWidget: Extension = [
  search({ top: true, createPanel: (view) => new FindPanel(view) }),
  keymap.of([{ key: 'Mod-h', run: openReplace, preventDefault: true }]),
  findTheme
]
