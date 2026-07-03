import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from '@codemirror/view'
import { type EditorState, type Extension, type Range } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { isImage, parentOf } from '@shared/pathUtils'
import { ARCHIVED_CHAR, TAG_RE, WIKI_LINK_RE } from '@shared/parser/patterns'
import { openWikiTarget } from '@/stores/indexStore'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * Obsidian-style live preview: formatting marks are hidden unless the
 * selection touches them, checkboxes/images/rules render as widgets.
 * Decorations are recomputed for visible ranges on doc/selection/viewport
 * changes — the Lezer tree makes this cheap.
 */

class CheckboxWidget extends WidgetType {
  constructor(
    readonly char: string,
    /** Board column name for custom status chars (shown as a pill) */
    readonly statusName: string | null
  ) {
    super()
  }

  override eq(other: CheckboxWidget): boolean {
    return other.char === this.char && other.statusName === this.statusName
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'knote-task-checkbox'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = /^[xX]$/.test(this.char) || this.char === ARCHIVED_CHAR
    if (this.char === ARCHIVED_CHAR) {
      wrap.classList.add('archived')
    } else if (!input.checked && this.char !== ' ') {
      // Custom status char (e.g. "/" = in progress): show as partially done
      wrap.classList.add('alt-state')
      wrap.dataset.status = this.char
    }
    input.tabIndex = -1
    input.addEventListener('mousedown', (e) => e.preventDefault())
    input.addEventListener('click', (e) => {
      e.preventDefault()
      const pos = view.posAtDOM(wrap)
      const text = view.state.sliceDoc(pos, pos + 3)
      const m = /^\[(.)\]$/.exec(text)
      if (!m) return
      const next = /^[xX]$/.test(m[1]) ? ' ' : 'x'
      view.dispatch({
        changes: { from: pos, to: pos + 3, insert: `[${next}]` },
        userEvent: 'input.knote.toggleTask'
      })
    })
    wrap.appendChild(input)
    if (this.statusName) {
      const pill = document.createElement('span')
      pill.className = 'knote-task-status-pill'
      pill.textContent = this.statusName
      pill.title = `Kanban status: ${this.statusName} ([${this.char}])`
      wrap.appendChild(pill)
    }
    return wrap
  }

  override ignoreEvent(): boolean {
    return true
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string
  ) {
    super()
  }

  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'knote-embed-image'
    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.onerror = (): void => {
      wrap.textContent = `⚠ image not found: ${this.alt || this.src}`
      wrap.classList.add('broken')
    }
    wrap.appendChild(img)
    return wrap
  }
}

class HrWidget extends WidgetType {
  override eq(): boolean {
    return true
  }

  override toDOM(): HTMLElement {
    const hr = document.createElement('hr')
    hr.className = 'knote-hr'
    return hr
  }
}

/** Resolve a (possibly relative) markdown image URL to a vault path. */
function resolveVaultPath(baseFolder: string, url: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(url)
  } catch {
    decoded = url
  }
  const raw = decoded.startsWith('/')
    ? decoded.slice(1)
    : baseFolder
      ? `${baseFolder}/${decoded}`
      : decoded
  const out: string[] = []
  for (const part of raw.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
    } else {
      out.push(part)
    }
  }
  return out.join('/')
}

function toImgSrc(vaultPath: string): string {
  return 'knote://img/' + vaultPath.split('/').map(encodeURIComponent).join('/')
}

const TASK_LINE_RE = /^(\s*)([-*+]|\d+[.)])\s\[(.)\](\s|$)/

/** Decorate one line's [[wiki-links]]: hide syntax, style the display text. */
function decorateWikiLinks(
  decos: Range<Decoration>[],
  lineFrom: number,
  lineText: string,
  touches: (from: number, to: number) => boolean,
  getPath: () => string
): void {
  WIKI_LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKI_LINK_RE.exec(lineText)) !== null) {
    const start = lineFrom + m.index
    const end = start + m[0].length
    if (touches(start, end)) continue

    const embed = m[1] === '!'
    const target = m[2].trim()
    const heading = m[3] ? m[3].slice(1).trim() : ''
    const alias = m[4] ? m[4].slice(1).trim() : ''

    // Image embeds render as the image itself
    if (embed && isImage(target)) {
      const resolved = resolveVaultPath(parentOf(getPath()), target) ?? target
      decos.push(
        Decoration.replace({ widget: new ImageWidget(toImgSrc(resolved), target) }).range(start, end)
      )
      continue
    }

    const dataTarget = target + (heading ? '#' + heading : '')
    const openLen = (embed ? 3 : 2) + (alias ? m[2].length + (m[3]?.length ?? 0) + 1 : 0)
    const displayFrom = start + openLen
    const displayTo = end - 2
    // Hide "[[", or "[[target#heading|" when aliased; then "]]"
    decos.push(Decoration.replace({}).range(start, displayFrom))
    decos.push(
      Decoration.mark({
        class: 'cm-wikilink',
        attributes: { 'data-target': dataTarget }
      }).range(displayFrom, displayTo)
    )
    decos.push(Decoration.replace({}).range(displayTo, end))
  }
}

/** Style #tags (clickable, never hidden). */
function decorateTags(
  decos: Range<Decoration>[],
  lineFrom: number,
  lineText: string
): void {
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(lineText)) !== null) {
    const tag = m[2]
    if (/^\d+$/.test(tag)) continue
    const start = lineFrom + m.index + m[1].length
    decos.push(
      Decoration.mark({
        class: 'cm-tag',
        attributes: { 'data-tag': tag }
      }).range(start, start + 1 + tag.length)
    )
  }
}

/** `<span style="font-size:NNpx">text</span>` — hide the tags, scale the text. */
const FONT_SIZE_SPAN_RE = /<span style="font-size:(\d{2})px">(.*?)<\/span>/g

function decorateFontSize(
  decos: Range<Decoration>[],
  lineFrom: number,
  lineText: string,
  touches: (from: number, to: number) => boolean
): void {
  FONT_SIZE_SPAN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FONT_SIZE_SPAN_RE.exec(lineText)) !== null) {
    const start = lineFrom + m.index
    const end = start + m[0].length
    if (touches(start, end)) continue

    const size = m[1]
    const openLen = m[0].length - m[2].length - '</span>'.length
    const displayFrom = start + openLen
    const displayTo = end - '</span>'.length
    decos.push(Decoration.replace({}).range(start, displayFrom))
    decos.push(
      Decoration.mark({ attributes: { style: `font-size:${size}px` } }).range(displayFrom, displayTo)
    )
    decos.push(Decoration.replace({}).range(displayTo, end))
  }
}

function isInCode(tree: ReturnType<typeof syntaxTree>, pos: number): boolean {
  for (
    let node: SyntaxNode | null = tree.resolveInner(pos, 1);
    node;
    node = node.parent
  ) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'InlineCode') {
      return true
    }
  }
  return false
}

function buildDecorations(view: EditorView, getPath: () => string): DecorationSet {
  const decos: Range<Decoration>[] = []
  const state: EditorState = view.state
  const tree = syntaxTree(state)
  const quoteLineStarts = new Set<number>()
  const codeLineStarts = new Set<number>()

  // Frontmatter block: dim it (Obsidian shows a properties UI instead)
  const frontmatterLineStarts = new Set<number>()
  if (state.doc.lines > 1 && state.doc.line(1).text === '---') {
    for (let ln = 2; ln <= Math.min(state.doc.lines, 100); ln++) {
      const l = state.doc.line(ln)
      if (l.text === '---') {
        for (let i = 1; i <= ln; i++) frontmatterLineStarts.add(state.doc.line(i).from)
        break
      }
    }
  }

  const touches = (from: number, to: number): boolean =>
    state.selection.ranges.some((r) => r.from <= to && r.to >= from)
  const touchesLine = (pos: number): boolean => {
    const line = state.doc.lineAt(pos)
    return touches(line.from, line.to)
  }

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node): boolean | void => {
        switch (node.name) {
          case 'HeaderMark': {
            const parent = node.node.parent
            if (!parent || !parent.name.startsWith('ATXHeading')) break
            if (touchesLine(node.from)) break
            let end = node.to
            if (state.sliceDoc(end, end + 1) === ' ') end++
            decos.push(Decoration.replace({}).range(node.from, end))
            break
          }
          case 'EmphasisMark':
          case 'StrikethroughMark': {
            const parent = node.node.parent
            if (parent && touches(parent.from, parent.to)) break
            decos.push(Decoration.replace({}).range(node.from, node.to))
            break
          }
          case 'CodeMark': {
            const parent = node.node.parent
            if (!parent || parent.name !== 'InlineCode') break // keep ``` fences visible
            if (touches(parent.from, parent.to)) break
            decos.push(Decoration.replace({}).range(node.from, node.to))
            break
          }
          case 'Link': {
            if (touches(node.from, node.to)) break
            for (let child = node.node.firstChild; child; child = child.nextSibling) {
              if (child.name === 'LinkMark' || child.name === 'URL') {
                decos.push(Decoration.replace({}).range(child.from, child.to))
              }
            }
            break
          }
          case 'Image': {
            const text = state.sliceDoc(node.from, node.to)
            const m = /^!\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)\s*\)$/.exec(text)
            if (!m) break
            let url = m[2]
            if (url.startsWith('<')) url = url.slice(1, -1)
            if (/^[a-z][a-z0-9+.-]*:/i.test(url)) break // non-local scheme: leave as text
            const resolved = resolveVaultPath(parentOf(getPath()), url)
            if (!resolved || !isImage(resolved)) break
            if (touchesLine(node.from)) break
            decos.push(
              Decoration.replace({ widget: new ImageWidget(toImgSrc(resolved), m[1]) }).range(
                node.from,
                node.to
              )
            )
            return false
          }
          case 'HorizontalRule': {
            if (touchesLine(node.from)) break
            decos.push(
              Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to)
            )
            break
          }
          case 'Blockquote': {
            const first = state.doc.lineAt(node.from).number
            const last = state.doc.lineAt(node.to).number
            for (let ln = first; ln <= last; ln++) {
              quoteLineStarts.add(state.doc.line(ln).from)
            }
            break
          }
          case 'QuoteMark': {
            if (touchesLine(node.from)) break
            let end = node.to
            if (state.sliceDoc(end, end + 1) === ' ') end++
            decos.push(Decoration.replace({}).range(node.from, end))
            break
          }
          case 'FencedCode': {
            const first = state.doc.lineAt(node.from).number
            const last = state.doc.lineAt(node.to).number
            for (let ln = first; ln <= last; ln++) {
              codeLineStarts.add(state.doc.line(ln).from)
            }
            break
          }
        }
      }
    })

    // Line-based scans: checkboxes (so custom status chars like [/] work
    // even though GFM only parses [ ]/[x]), wiki-links, and tags.
    let pos = from
    while (pos <= to) {
      const line = state.doc.lineAt(pos)
      const inCodeBlock = codeLineStarts.has(line.from)

      const m = TASK_LINE_RE.exec(line.text)
      if (m && !inCodeBlock) {
        const bracketFrom = line.from + m[1].length + m[2].length + 1
        const bracketTo = bracketFrom + 3
        if (!isInCode(tree, bracketFrom) && !touches(bracketFrom, bracketTo)) {
          const char = m[3]
          let statusName: string | null = null
          if (char === ARCHIVED_CHAR) {
            statusName = 'Archived'
          } else if (char !== ' ' && !/^[xX]$/.test(char)) {
            const columns = useSettingsStore.getState().vaultConfig.columns
            statusName = columns.find((c) => c.char === char)?.name ?? `[${char}]`
          }
          decos.push(
            Decoration.replace({ widget: new CheckboxWidget(char, statusName) }).range(
              bracketFrom,
              bracketTo
            )
          )
        }
        if (/^[xX]$/.test(m[3])) {
          decos.push(Decoration.line({ class: 'cm-task-done' }).range(line.from))
        } else if (m[3] === ARCHIVED_CHAR) {
          decos.push(Decoration.line({ class: 'cm-task-archived' }).range(line.from))
        }
      }

      if (!inCodeBlock && !frontmatterLineStarts.has(line.from)) {
        decorateWikiLinks(decos, line.from, line.text, touches, getPath)
        decorateTags(decos, line.from, line.text)
        decorateFontSize(decos, line.from, line.text, touches)
      }

      if (line.to >= to) break
      pos = line.to + 1
    }
  }

  for (const lineStart of frontmatterLineStarts) {
    decos.push(Decoration.line({ class: 'cm-frontmatter-line' }).range(lineStart))
  }

  for (const lineStart of quoteLineStarts) {
    decos.push(Decoration.line({ class: 'cm-blockquote-line' }).range(lineStart))
  }
  for (const lineStart of codeLineStarts) {
    decos.push(Decoration.line({ class: 'cm-codeblock-line' }).range(lineStart))
  }

  return Decoration.set(decos, true)
}

/** Click-to-open for rendered wiki-links and tag search jumps. */
const linkClickHandler = EditorView.domEventHandlers({
  mousedown(event) {
    const el = (event.target as HTMLElement).closest?.('.cm-wikilink, .cm-tag')
    if (!el || event.button !== 0) return false
    event.preventDefault()
    if (el.classList.contains('cm-wikilink')) {
      const target = el.getAttribute('data-target')
      if (target) void openWikiTarget(target)
    } else {
      const tag = el.getAttribute('data-tag')
      if (tag) useUiStore.getState().searchFor('tag:#' + tag)
    }
    return true
  }
})

export function livePreviewExtension(getPath: () => string): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view, getPath)
        }

        update(update: ViewUpdate): void {
          if (update.docChanged || update.viewportChanged || update.selectionSet) {
            this.decorations = buildDecorations(update.view, getPath)
          }
        }
      },
      { decorations: (v) => v.decorations }
    ),
    linkClickHandler
  ]
}
