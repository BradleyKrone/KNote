import type { Mention, VaultPath } from '@shared/types'
import { samePath } from '@shared/pathUtils'
import { WIKI_LINK_RE } from '@shared/parser/parseNote'
import * as vaultIndex from './vaultIndex'

const MAX_MENTIONS = 200

/**
 * Finds plain-text occurrences of the given strings (a note's title and
 * aliases) across the vault — skipping occurrences that are already inside
 * a [[wiki-link]] and partial-word matches.
 */
export function findMentions(strings: string[], excludePath: VaultPath): Mention[] {
  const results: Mention[] = []
  // Longest needles first so "Ada Lovelace" wins over its substring alias "Ada"
  const needles = strings
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (needles.length === 0) return results

  for (const [path, content] of vaultIndex.getAllContents()) {
    if (samePath(path, excludePath)) continue
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lower = line.toLowerCase()

      const linkRanges: Array<[number, number]> = []
      WIKI_LINK_RE.lastIndex = 0
      let lm: RegExpExecArray | null
      while ((lm = WIKI_LINK_RE.exec(line)) !== null) {
        linkRanges.push([lm.index, lm.index + lm[0].length])
      }

      const claimed: Array<[number, number]> = []
      for (const needle of needles) {
        const lowerNeedle = needle.toLowerCase()
        let idx = 0
        while ((idx = lower.indexOf(lowerNeedle, idx)) !== -1) {
          const end = idx + needle.length
          const insideLink = linkRanges.some(([a, b]) => idx >= a && end <= b)
          const overlapsLonger = claimed.some(([a, b]) => idx < b && end > a)
          const beforeOk = idx === 0 || !/[\w#[]/.test(line[idx - 1])
          const afterOk = end >= line.length || !/\w/.test(line[end])
          if (!insideLink && !overlapsLonger && beforeOk && afterOk) {
            claimed.push([idx, end])
            results.push({ path, line: i, text: line, col: idx, length: needle.length, matched: needle })
            if (results.length >= MAX_MENTIONS) return results
          }
          idx = end
        }
      }
    }
  }
  return results
}
