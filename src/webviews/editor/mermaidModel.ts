// Pure fenced-code-block parsing for Mermaid diagrams — no CodeMirror or DOM
// imports, so it's unit-testable under vitest and shared by mermaidRender.ts.

export interface ParsedFence {
  lang: string
  body: string
}

/**
 * Parse a raw fenced code block (including its opening/closing fence lines,
 * e.g. the full text of a Lezer `FencedCode` node) into its info-string
 * language token and body. The language is the first whitespace-delimited
 * word on the opening fence line (CommonMark's info-string convention),
 * compared case-sensitively. The body is every line between the fences,
 * preserved verbatim — including internal blank lines — since a diagram's
 * exact source must not be mangled.
 */
export function parseFence(raw: string): ParsedFence {
  const lines = raw.split(/\r?\n/)
  const first = lines[0] ?? ''
  const lang =
    first
      .replace(/^`{3,}|^~{3,}/, '')
      .trim()
      .split(/\s+/)[0] ?? ''

  const last = lines.length - 1
  const hasClosingFence = last > 0 && /^\s*(`{3,}|~{3,})\s*$/.test(lines[last])
  const bodyLines = hasClosingFence ? lines.slice(1, last) : lines.slice(1)
  return { lang, body: bodyLines.join('\n') }
}

/** True when a raw fenced code block's info string is exactly `mermaid`. */
export function isMermaidFence(raw: string): boolean {
  return parseFence(raw).lang === 'mermaid'
}
