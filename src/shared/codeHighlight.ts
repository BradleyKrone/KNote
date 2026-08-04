// Syntax highlighting for fenced code blocks in rendered markdown (Reading
// mode's hover previews / note embeds — see renderMarkdown.ts). Uses
// highlight.js's core with only the requested languages registered, rather
// than the full ~190-language build or the `common` bundle, to keep the
// VSIX small; everything is bundled offline, no CDN.

import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import bash from 'highlight.js/lib/languages/bash'
import markdown from 'highlight.js/lib/languages/markdown'
import yaml from 'highlight.js/lib/languages/yaml'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import java from 'highlight.js/lib/languages/java'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('json', json)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('java', java)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('sql', sql)

/**
 * Highlight a fenced code block's body for the given info-string language,
 * for markdown-it's `highlight` renderer option. Returns '' for an unknown
 * or absent language — markdown-it treats a falsy result as "no highlight"
 * and falls back to its own escaped `<pre><code class="language-x">` default
 * (plain text, still safe). A known language returns the full
 * `<pre><code>` markup itself (starting with `<pre`, which markdown-it uses
 * verbatim) so both the `hljs` and `language-x` classes land on it —
 * markdown-it's own wrapping only ever adds the latter.
 */
export function hljsHighlight(code: string, lang: string): string {
  const language = lang.trim().toLowerCase()
  if (!language || !hljs.getLanguage(language)) return ''
  const html = hljs.highlight(code, { language, ignoreIllegals: true }).value
  return `<pre><code class="hljs language-${language}">${html}</code></pre>`
}
