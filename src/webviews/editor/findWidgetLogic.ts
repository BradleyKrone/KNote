// Pure half of the find widget (findWidget.ts): the "3 of 12" match count.
// No DOM, so vitest can drive it against a bare EditorState.

import type { EditorState } from '@codemirror/state'
import type { SearchQuery } from '@codemirror/search'

/** Past this many matches the count stops walking and shows "1000+", as VS Code does. */
export const MATCH_LIMIT = 1000

export interface MatchCount {
  /** Matches found, up to `limit`. */
  total: number
  /** 1-based index of the match the main selection sits on exactly; 0 when it isn't on one. */
  current: number
  /** True when the walk stopped at `limit` — there may be more. */
  capped: boolean
}

export function countMatches(
  state: EditorState,
  query: SearchQuery,
  limit = MATCH_LIMIT
): MatchCount {
  if (!query.valid) return { total: 0, current: 0, capped: false }
  const { from, to } = state.selection.main
  const cursor = query.getCursor(state)
  let total = 0
  let current = 0
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (total === limit) return { total, current, capped: true }
    total++
    if (next.value.from === from && next.value.to === to) current = total
  }
  return { total, current, capped: false }
}

/** The label beside the find input — empty for an empty query, like VS Code. */
export function formatCount(query: SearchQuery, count: MatchCount): string {
  if (!query.search) return ''
  if (count.total === 0) return 'No results'
  const total = count.capped ? `${count.total}+` : String(count.total)
  return `${count.current > 0 ? count.current : '?'} of ${total}`
}
