/**
 * Converting a task's own note block between the indented lines that live on
 * disk (`TaskItem.noteLines`) and the flat text a plain textarea edits.
 *
 * Pure and dependency-free on purpose: the board's task editor runs in a
 * webview, the write path runs in the extension host, and both need the same
 * answer about what indent a note block sits at.
 */

import { TASK_LINE_RE } from './patterns'

/** The indent a task's attached note lines sit at: the task's own indent + 2, matching what `insertTaskNote` and the editor's Enter-key seed write. */
export function taskChildIndent(taskLineText: string): string {
  const m = TASK_LINE_RE.exec(taskLineText)
  return (m ? m[1] : '') + '  '
}

/** Leading run of spaces/tabs on a line. */
function leadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? ''
}

/**
 * The indentation a note block is written at: the longest common leading
 * whitespace shared by its non-blank lines, compared character by character so
 * a tab-indented note stays tab-indented. Falls back to `fallback` for an empty
 * block, and for the mixed tabs-and-spaces case where the lines share no
 * prefix — there the block normalises to `fallback` on the next save, a visible
 * one-time tidy rather than a guess.
 */
export function noteBodyIndent(body: string[], fallback: string): string {
  let common: string | null = null
  for (const line of body) {
    if (/^\s*$/.test(line)) continue
    const ws = leadingWhitespace(line)
    if (common === null) {
      common = ws
      continue
    }
    let i = 0
    while (i < common.length && i < ws.length && common[i] === ws[i]) i++
    common = common.slice(0, i)
  }
  return common === null || common === '' ? fallback : common
}

/**
 * The base indent a block round-trips through: whatever its own lines already
 * share, and `fallback` only when there is no block yet (a task getting its
 * first note). Deliberately *not* `noteBodyIndent(block, fallback)`: a block
 * whose lines share no common prefix — a fenced code sample dedented to column
 * 0, say — is what `noteBodyToText` hands back verbatim, so re-applying the
 * fallback on the way in would indent the whole thing by two on every save.
 * `noteBodyToText` and `noteBodyFromText` have to be exact inverses.
 */
export function blockBaseIndent(block: string[], fallback: string): string {
  return block.length === 0 ? fallback : noteBodyIndent(block, '')
}

/**
 * Block lines → the text the editor shows: the block's common indent stripped
 * off the front of every line, blank lines emptied. Anything indented deeper
 * keeps its *relative* indent, so a nested sub-bullet under `- Notes:` survives
 * a round trip unchanged.
 */
export function noteBodyToText(body: string[]): string {
  const indent = noteBodyIndent(body, '')
  return body
    .map((line) => {
      if (/^\s*$/.test(line)) return ''
      return line.startsWith(indent) ? line.slice(indent.length) : line.trimStart()
    })
    .join('\n')
}

/**
 * Editor text → block lines, the inverse of `noteBodyToText`. Splits on CR/LF
 * in any combination so a paste out of a CRLF file can't smuggle a `\r` into a
 * line — the write path rejoins with the file's own EOL and a stray `\r` would
 * double it. Re-applies `indent` to non-blank lines only (a blank line stays
 * genuinely blank rather than becoming trailing whitespace), and drops leading
 * and trailing blank lines: `ownNoteBlockEnd` excludes trailing blanks from the
 * block, so keeping them would grow the note by a line on every save.
 */
export function noteBodyFromText(text: string, indent: string): string[] {
  const lines = text.split(/\r\n?|\n/).map((line) => {
    // Whatever relative indent the user typed is already on the front of the
    // line and rides along; only the block's own base indent is re-added.
    const trimmedEnd = line.replace(/\s+$/, '')
    return trimmedEnd === '' ? '' : indent + trimmedEnd
  })
  while (lines.length > 0 && lines[0] === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}
