import { useEffect, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { visit } from 'unist-util-visit'
import { isImage, parentOf } from '@shared/pathUtils'
import { TASK_LINE_RE, WIKI_LINK_RE } from '@shared/parser/patterns'
import { openWikiTarget, resolveTarget } from '@/stores/indexStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'

const MAX_EMBED_DEPTH = 3

function toImgSrc(vaultPath: string): string {
  return 'knote://img/' + vaultPath.split('/').map(encodeURIComponent).join('/')
}

function resolveRelative(baseFolder: string, url: string): string {
  const raw = url.startsWith('/') ? url.slice(1) : baseFolder ? `${baseFolder}/${url}` : url
  const out: string[] = []
  for (const part of raw.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/**
 * Rewrites KNote-specific syntax into standard markdown that react-markdown
 * can render: wiki links become knote-wiki: links, note embeds become
 * knote-embed: links, image embeds become plain images. Frontmatter is
 * blanked (not removed) so source line numbers survive for checkbox toggles.
 */
function preprocess(content: string, notePath: string): string {
  let out = content
  const fm = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/.exec(out)
  if (fm) {
    const blank = fm[0].replace(/[^\n]/g, '')
    out = blank + out.slice(fm[0].length)
  }
  out = out.replace(WIKI_LINK_RE, (_full, bang, target, heading, alias) => {
    const t = String(target).trim()
    const h = heading ? String(heading) : ''
    const a = alias ? String(alias).slice(1).trim() : ''
    if (bang === '!') {
      if (isImage(t)) return `![${t}](${toImgSrc(resolveRelative(parentOf(notePath), t))})`
      return `[${t}](knote-embed:${encodeURIComponent(t)})`
    }
    const display = a || t + h
    return `[${display}](knote-wiki:${encodeURIComponent(t + h)})`
  })
  return out
}

function urlTransform(url: string): string {
  if (url.startsWith('knote')) return url
  return defaultUrlTransform(url)
}

/**
 * GFM's synthetic checkbox <input> carries no source position — copy the
 * parent <li>'s start line onto it so clicks can rewrite the right line.
 */
function rehypeTaskLines() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any): void => {
    visit(tree, 'element', (node: any) => {
      if (node.tagName !== 'li' || !node.position) return
      const stack = [...(node.children ?? [])]
      while (stack.length) {
        const child = stack.shift()
        if (child?.tagName === 'input' && child.properties?.type === 'checkbox') {
          child.properties.dataLine = node.position.start.line
          return
        }
        if (child?.children) stack.unshift(...child.children)
      }
    })
  }
}

const FONT_SIZE_STYLE_RE = /^font-size:\d{2}px$/

/**
 * rehype-raw turns any raw HTML written in a note into real elements — the
 * only raw HTML KNote itself ever writes is the font-size span from
 * formatting.ts's adjustFontSize. Strip everything else a pasted/foreign
 * note might smuggle in: dangerous tags outright, event handlers on any
 * element, and any `style` value that isn't exactly our font-size pattern
 * (CSS can still fetch remote resources via url(), so it's not passed
 * through unchecked even on an allowed tag).
 */
const DANGEROUS_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form'
])

function rehypeSanitizeRawHtml() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree, 'element', (node: any, index: any, parent: any) => {
      if (DANGEROUS_TAGS.has(node.tagName) && parent && typeof index === 'number') {
        parent.children.splice(index, 1, ...(node.children ?? []))
        return index
      }
      const props = node.properties ?? {}
      for (const key of Object.keys(props)) {
        if (/^on/i.test(key)) delete props[key]
      }
      if ('style' in props && !(node.tagName === 'span' && FONT_SIZE_STYLE_RE.test(props.style))) {
        delete props.style
      }
      return undefined
    })
  }
}

interface MdProps {
  content: string
  path: string
  depth: number
  onToggleTask?: (line1: number) => void
}

function Md({ content, path, depth, onToggleTask }: MdProps): React.JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, rehypeSanitizeRawHtml, rehypeTaskLines]}
      urlTransform={urlTransform}
      components={{
        a: ({ href, children }) => {
          if (href?.startsWith('knote-wiki:')) {
            const target = decodeURIComponent(href.slice('knote-wiki:'.length))
            return (
              <a
                className="cm-wikilink"
                onClick={(e) => {
                  e.preventDefault()
                  void openWikiTarget(target)
                }}
              >
                {children}
              </a>
            )
          }
          if (href?.startsWith('knote-embed:')) {
            const target = decodeURIComponent(href.slice('knote-embed:'.length))
            return <Transclusion target={target} depth={depth} />
          }
          // External links stay inert — KNote makes no network calls
          return (
            <a className="external-link" title={href} onClick={(e) => e.preventDefault()}>
              {children}
            </a>
          )
        },
        input: ({ node, checked }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const line = (node as any)?.properties?.dataLine as number | undefined
          return (
            <input
              type="checkbox"
              checked={!!checked}
              onChange={() => {
                if (line !== undefined && onToggleTask) onToggleTask(line)
              }}
            />
          )
        }
      }}
    >
      {preprocess(content, path)}
    </ReactMarkdown>
  )
}

/** ![[Note]] — renders the target note's content inline (Obsidian embeds). */
function Transclusion({ target, depth }: { target: string; depth: number }): React.JSX.Element {
  const [content, setContent] = useState<string | null>(null)
  const resolved = resolveTarget(target)

  useEffect(() => {
    if (!resolved || depth >= MAX_EMBED_DEPTH) return
    let alive = true
    void window.knote.readFile(resolved).then((r) => {
      if (alive) setContent(r.content)
    })
    return () => {
      alive = false
    }
  }, [resolved, depth])

  if (depth >= MAX_EMBED_DEPTH) return <span className="embed-error">embed too deep</span>
  if (!resolved) return <span className="embed-error">⚠ {target} not found</span>
  return (
    <span className="knote-transclusion">
      <span className="knote-transclusion-title" onClick={() => void openWikiTarget(target)}>
        {target}
      </span>
      {content !== null && <Md content={content} path={resolved} depth={depth + 1} />}
    </span>
  )
}

export function ReadingView(): React.JSX.Element | null {
  const note = useWorkspaceStore((s) => s.note)
  if (!note) return null

  const toggleTask = async (line1: number): Promise<void> => {
    const rawLine = note.content.split(/\r?\n/)[line1 - 1]
    if (rawLine === undefined) return
    const m = TASK_LINE_RE.exec(rawLine)
    if (!m) return
    const next = /^[xX]$/.test(m[3]) ? ' ' : 'x'
    const newLine =
      rawLine.slice(0, m[1].length + m[2].length + 2) + next + rawLine.slice(m[1].length + m[2].length + 3)
    try {
      await window.knote.replaceLine(note.path, line1 - 1, rawLine, newLine)
      await useWorkspaceStore.getState().openFile(note.path)
    } catch {
      await useWorkspaceStore.getState().openFile(note.path)
    }
  }

  return (
    <div className="reading-view">
      <div className="reading-content">
        <Md content={note.content} path={note.path} depth={0} onToggleTask={(l) => void toggleTask(l)} />
      </div>
    </div>
  )
}
