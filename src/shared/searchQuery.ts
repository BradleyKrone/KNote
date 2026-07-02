/**
 * Parses Obsidian-style search queries:
 *   plain terms   full-text (AND)
 *   "a phrase"    exact phrase
 *   -term         exclude notes containing term
 *   path:Work     path substring filter
 *   file:daily    file name substring filter
 *   tag:#project  tag filter (# optional)
 */

export interface ParsedQuery {
  terms: string[]
  phrases: string[]
  excludes: string[]
  path: string[]
  file: string[]
  tag: string[]
}

export function parseSearchQuery(query: string): ParsedQuery {
  const out: ParsedQuery = { terms: [], phrases: [], excludes: [], path: [], file: [], tag: [] }
  // Tokens: quoted strings (optionally prefixed) or bare words
  const tokenRe = /(-?)(?:(path|file|tag):)?(?:"([^"]*)"|(\S+))/g
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(query)) !== null) {
    const negated = m[1] === '-'
    const operator = m[2]?.toLowerCase()
    const value = (m[3] ?? m[4] ?? '').trim()
    if (!value) continue
    if (operator === 'path') out.path.push(value)
    else if (operator === 'file') out.file.push(value)
    else if (operator === 'tag') out.tag.push(value.replace(/^#/, ''))
    else if (negated) out.excludes.push(value)
    else if (m[3] !== undefined) out.phrases.push(value)
    else out.terms.push(value)
  }
  return out
}
