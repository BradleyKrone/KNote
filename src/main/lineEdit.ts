// Verified, targeted line edits — how the Kanban board and quick capture
// write into notes without clobbering them. Every function re-reads the file
// and refuses to write when the target line changed (KNOTE_STALE).

import { promises as fs } from 'fs'
import type { VaultPath } from '@shared/types'
import { REASON_FOR_RE, TASK_LINE_RE } from '@shared/parser/patterns'
import { toAbs, writeFileAtomic } from './vaultService'
import { isConflictError, STALE_ERROR } from '@shared/errors'

/** Split note content into lines, preserving the file's EOL style for rejoin. */
async function readNoteLines(rel: VaultPath): Promise<{ eol: string; lines: string[] }> {
  const content = await fs.readFile(toAbs(rel), 'utf-8')
  return {
    eol: content.includes('\r\n') ? '\r\n' : '\n',
    lines: content.split(/\r?\n/)
  }
}

/**
 * Find the line to edit: trust lineNo only if its text still matches;
 * otherwise tolerate the line having shifted, but only when the expected
 * text appears exactly once. Returns -1 when the edit would be ambiguous.
 */
function locateLine(lines: string[], lineNo: number, expectedText: string): number {
  if (lines[lineNo] === expectedText) return lineNo
  const matches = lines.reduce<number[]>((acc, l, i) => {
    if (l === expectedText) acc.push(i)
    return acc
  }, [])
  if (matches.length === 1) return matches[0]
  return -1
}

/**
 * Verified, targeted single-line rewrite — the core two-way-sync primitive.
 *
 * Never trusts the caller's line number alone: the file is read fresh, the
 * expected text must match at that line (or at exactly one other line, to
 * tolerate lines having shifted). EOL style and trailing newline are
 * preserved so the on-disk diff is exactly one line.
 */
export async function replaceLine(
  rel: VaultPath,
  lineNo: number,
  expectedText: string,
  newText: string
): Promise<void> {
  const { eol, lines } = await readNoteLines(rel)
  const target = locateLine(lines, lineNo, expectedText)
  if (target === -1) throw new Error(`${STALE_ERROR}: line changed on disk in ${rel}`)
  lines[target] = newText
  await writeFileAtomic(rel, lines.join(eol))
}

/**
 * Verified status-char rewrite that also attaches a `Reason for <Column>: ...`
 * note line directly under the task (inserted, or replacing an existing
 * reason line already sitting there) — one atomic write for both edits.
 */
export async function setTaskStatusReason(
  rel: VaultPath,
  lineNo: number,
  expectedText: string,
  targetChar: string,
  reasonLine: string
): Promise<void> {
  const { eol, lines } = await readNoteLines(rel)
  const target = locateLine(lines, lineNo, expectedText)
  if (target === -1) throw new Error(`${STALE_ERROR}: line changed on disk in ${rel}`)

  const m = TASK_LINE_RE.exec(lines[target])
  if (!m) throw new Error(`${STALE_ERROR}: line changed on disk in ${rel}`)
  const bracketOffset = m[1].length + m[2].length + 2
  lines[target] =
    lines[target].slice(0, bracketOffset) + targetChar + lines[target].slice(bracketOffset + 1)

  const nextLine = lines[target + 1]
  if (nextLine !== undefined && REASON_FOR_RE.test(nextLine)) {
    lines[target + 1] = reasonLine
  } else {
    lines.splice(target + 1, 0, reasonLine)
  }
  await writeFileAtomic(rel, lines.join(eol))
}

/** Verified line delete (Kanban "delete card"). */
export async function deleteLine(rel: VaultPath, lineNo: number, expectedText: string): Promise<void> {
  const { eol, lines } = await readNoteLines(rel)
  const target = locateLine(lines, lineNo, expectedText)
  if (target === -1) throw new Error(`${STALE_ERROR}: line changed on disk in ${rel}`)
  lines.splice(target, 1)
  await writeFileAtomic(rel, lines.join(eol))
}

/**
 * Verified line move (same-note reorder on the board): moves the line at
 * fromLine so it sits before beforeLine (or at the end when beforeLine is
 * -1). Both lines are verified against their expected text.
 */
export async function moveLine(
  rel: VaultPath,
  fromLine: number,
  expectedText: string,
  beforeLine: number,
  beforeExpectedText: string | null
): Promise<void> {
  const { eol, lines } = await readNoteLines(rel)
  const source = locateLine(lines, fromLine, expectedText)
  if (source === -1) throw new Error(`${STALE_ERROR}: line changed on disk in ${rel}`)
  let dest: number
  if (beforeLine === -1 || beforeExpectedText === null) {
    dest = lines.length
  } else {
    dest = locateLine(lines, beforeLine, beforeExpectedText)
    if (dest === -1) throw new Error(`${STALE_ERROR}: target line changed on disk in ${rel}`)
  }
  const [moved] = lines.splice(source, 1)
  if (dest > source) dest--
  lines.splice(dest, 0, moved)
  await writeFileAtomic(rel, lines.join(eol))
}

/**
 * Append a line to a note, creating the note if it doesn't exist.
 *
 * Read-modify-write guarded by optimistic concurrency: if an external edit
 * lands between our read and the atomic rename, the write is refused and the
 * append retries against the fresh content instead of clobbering the edit.
 */
export async function appendLine(rel: VaultPath, text: string): Promise<void> {
  const abs = toAbs(rel)
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    let content = ''
    let expectedMtimeMs: number | undefined
    try {
      // stat before read: an edit landing between the two makes the content
      // newer than the recorded mtime, which fails the write check (safe
      // direction) rather than slipping past it.
      expectedMtimeMs = (await fs.stat(abs)).mtimeMs
      content = await fs.readFile(abs, 'utf-8')
    } catch {
      // new file
    }
    const eol = content.includes('\r\n') ? '\r\n' : '\n'
    let out = content
    if (out !== '' && !out.endsWith('\n')) out += eol
    out += text + eol
    try {
      await writeFileAtomic(rel, out, expectedMtimeMs)
      return
    } catch (err) {
      if (!isConflictError(err)) throw err
      lastErr = err
    }
  }
  throw lastErr
}
