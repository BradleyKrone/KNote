// Inline formatting toggles (**bold**, *italic*, ~~strike~~, `code`) for the
// native editor — VS Code ships no built-ins for these. Ported from the
// CodeMirror implementation: empty selections expand to the word at the
// cursor, whitespace stays outside the wrapper, re-applying unwraps, and
// applying a different emphasis marker swaps instead of stacking.

import * as vscode from 'vscode'
import { vaultNoteRel } from '../paths'

/** Mutually-exclusive inline emphasis wrappers, longest first so `**` is
 *  never mistaken for a `*` italic marker. */
const EMPHASIS_MARKERS = ['**', '~~', '*']

interface Change {
  from: number
  to: number
  insert: string
}

function markerBefore(text: string, pos: number, marker: string): boolean {
  const len = marker.length
  if (text.slice(Math.max(0, pos - len), pos) !== marker) return false
  if (marker !== '*') return true
  return text.slice(Math.max(0, pos - 2), pos - 1) !== '*'
}

function markerAfter(text: string, pos: number, marker: string): boolean {
  const len = marker.length
  if (text.slice(pos, pos + len) !== marker) return false
  if (marker !== '*') return true
  return text.slice(pos + 1, pos + 2) !== '*'
}

function innerWrappedBy(inner: string, marker: string): boolean {
  if (inner.length < 2 * marker.length) return false
  if (!inner.startsWith(marker) || !inner.endsWith(marker)) return false
  if (marker === '*' && (inner.startsWith('**') || inner.endsWith('**'))) return false
  return true
}

/** Compute the wrap/unwrap/swap changes for one selection range (offsets). */
function changesForRange(text: string, from: number, to: number, marker: string): Change[] {
  const len = marker.length
  const otherMarkers = EMPHASIS_MARKERS.includes(marker)
    ? EMPHASIS_MARKERS.filter((m) => m !== marker)
    : []

  // Hug the markers to the non-whitespace text
  const raw = text.slice(from, to)
  const leading = raw.length - raw.trimStart().length
  const trailing = raw.length - raw.trimEnd().length
  if (leading + trailing < raw.length) {
    from += leading
    to -= trailing
  }
  const inner = text.slice(from, to)

  if (markerBefore(text, from, marker) && markerAfter(text, to, marker)) {
    return [
      { from: from - len, to: from, insert: '' },
      { from: to, to: to + len, insert: '' }
    ]
  }
  if (innerWrappedBy(inner, marker)) {
    return [
      { from, to: from + len, insert: '' },
      { from: to - len, to, insert: '' }
    ]
  }
  for (const other of otherMarkers) {
    const oLen = other.length
    if (markerBefore(text, from, other) && markerAfter(text, to, other)) {
      return [
        { from: from - oLen, to: from, insert: marker },
        { from: to, to: to + oLen, insert: marker }
      ]
    }
    if (innerWrappedBy(inner, other)) {
      return [
        { from, to: from + oLen, insert: marker },
        { from: to - oLen, to, insert: marker }
      ]
    }
  }
  return [
    { from, to: from, insert: marker },
    { from: to, to, insert: marker }
  ]
}

async function toggleInline(marker: string): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor || vaultNoteRel(editor.document) === null) return
  const doc = editor.document
  const text = doc.getText()

  const changes: Change[] = []
  for (const sel of editor.selections) {
    let from = doc.offsetAt(sel.start)
    let to = doc.offsetAt(sel.end)
    if (from === to) {
      const word = doc.getWordRangeAtPosition(sel.start)
      if (word) {
        from = doc.offsetAt(word.start)
        to = doc.offsetAt(word.end)
      }
    }
    changes.push(...changesForRange(text, from, to, marker))
  }

  await editor.edit((b) => {
    for (const c of changes) {
      if (c.from === c.to) b.insert(doc.positionAt(c.from), c.insert)
      else if (c.insert === '') b.delete(new vscode.Range(doc.positionAt(c.from), doc.positionAt(c.to)))
      else b.replace(new vscode.Range(doc.positionAt(c.from), doc.positionAt(c.to)), c.insert)
    }
  })
}

export function registerFormattingCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('knote.format.bold', () => toggleInline('**')),
    vscode.commands.registerCommand('knote.format.italic', () => toggleInline('*')),
    vscode.commands.registerCommand('knote.format.strikethrough', () => toggleInline('~~')),
    vscode.commands.registerCommand('knote.format.code', () => toggleInline('`'))
  )
}
