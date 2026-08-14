// Message protocol between the live-preview editor webview (CodeMirror) and
// its CustomTextEditorProvider host (src/extension/views/liveEditorProvider.ts).
//
// These ride the same webview.postMessage channel as the HostApi RPC, but
// carry a `type` discriminator instead of the RPC `id`/`method`/`event`
// shape, so the RPC router (webviewRpc.attach) and the RPC client
// (webviews/shared/rpc.ts) both ignore them and only the sync glue reacts.

/**
 * A position in the document, as 0-based line + character-within-line.
 *
 * Line/character — not an absolute offset — is deliberately the currency of
 * this protocol. CodeMirror and VS Code agree exactly on the line index and on
 * the character index within a line, whatever the file's EOL. They do NOT agree
 * on absolute offsets: CodeMirror's `Text` counts a line break as one
 * character, always, while `TextDocument.positionAt` counts `\r\n` as two. An
 * offset sent across this boundary therefore lands one character too early per
 * preceding line on a CRLF note, scattering dropped characters through the
 * saved file while the CodeMirror view still looks correct.
 */
export interface CmPos {
  line: number
  ch: number
}

/** A single replacement, in the pre-change document's line/character positions. */
export interface CmEdit {
  from: CmPos
  to: CmPos
  insert: string
}

/** Webview → host: the user changed the document in CodeMirror. */
export interface CmEditsMessage {
  type: 'knote:cm-edits'
  edits: CmEdit[]
}

/** Host → webview: the document changed outside CodeMirror — replace content. */
export interface HostUpdateMessage {
  type: 'knote:host-update'
  text: string
}

/**
 * Host → webview: scroll to and place the cursor on a line (0-based), used
 * when a note is opened from the board/timeline/etc. to jump to a task.
 */
export interface RevealLineMessage {
  type: 'knote:reveal-line'
  line: number
}

/**
 * Webview → host: which foldable lines are currently collapsed, identified by
 * their trimmed line text (there's no stable heading/section id to key on).
 * Sent whenever the fold state changes, and persisted so the note reopens
 * with the same sections collapsed.
 */
export interface FoldStateMessage {
  type: 'knote:fold-state'
  keys: string[]
}

export type EditorSyncMessage =
  | CmEditsMessage
  | HostUpdateMessage
  | RevealLineMessage
  | FoldStateMessage

/**
 * A replacement in plain string offsets. Only ever used *within* one side of
 * the boundary (CodeMirror reconciling an inbound host update against its own
 * document), never on the wire — see CmPos for why offsets can't cross.
 */
export interface OffsetEdit {
  from: number
  to: number
  insert: string
}

/**
 * The single minimal replacement that turns `current` into `next`, found by
 * trimming their common prefix and suffix. Applying only this span (rather than
 * replacing the whole document) keeps every position outside it — and the
 * editor's scroll anchor — fixed when the host pushes an updated note back.
 * Returns a no-op edit (an empty range with an empty insert) when they're
 * identical — though callers should short-circuit equal strings before calling.
 *
 * Both strings must already be in the same EOL space (the caller normalizes the
 * host's text to CodeMirror's LF before diffing), so the offsets returned are
 * valid CodeMirror positions.
 */
export function diffEdit(current: string, next: string): OffsetEdit {
  let from = 0
  const max = Math.min(current.length, next.length)
  while (from < max && current.charCodeAt(from) === next.charCodeAt(from)) from++
  let toOld = current.length
  let toNew = next.length
  while (
    toOld > from &&
    toNew > from &&
    current.charCodeAt(toOld - 1) === next.charCodeAt(toNew - 1)
  ) {
    toOld--
    toNew--
  }
  return { from, to: toOld, insert: next.slice(from, toNew) }
}

/**
 * Resolve a line/character position to an absolute offset into `text`, whose
 * lines are separated by `eol`. Positions past the end of a line (or past the
 * last line) clamp, matching how VS Code resolves an out-of-range Position.
 */
function offsetOf(lineStarts: number[], lineEnds: number[], pos: CmPos): number {
  const line = Math.max(0, Math.min(pos.line, lineStarts.length - 1))
  const ch = Math.max(0, Math.min(pos.ch, lineEnds[line] - lineStarts[line]))
  return lineStarts[line] + ch
}

/**
 * Apply CmEdits to a string, mirroring how the host applies them to the
 * TextDocument: every edit's positions are resolved against the *pre-edit*
 * text (exactly like the TextEdits in a WorkspaceEdit), so they're spliced in
 * descending order to keep earlier offsets valid.
 *
 * `insert` arrives in CodeMirror's LF space and is translated to `eol` here,
 * so the result never picks up mixed line endings.
 *
 * The host uses this to predict the post-edit buffer text, which is what lets
 * it tell its own echo apart from a concurrent external edit exactly, rather
 * than with a flag held across an await.
 */
export function applyCmEdits(text: string, edits: CmEdit[], eol: string): string {
  const lineStarts: number[] = [0]
  const lineEnds: number[] = []
  for (let i = text.indexOf(eol); i !== -1; i = text.indexOf(eol, i + eol.length)) {
    lineEnds.push(i)
    lineStarts.push(i + eol.length)
  }
  lineEnds.push(text.length)

  const resolved = edits
    .map((e) => ({
      from: offsetOf(lineStarts, lineEnds, e.from),
      to: offsetOf(lineStarts, lineEnds, e.to),
      insert: eol === '\n' ? e.insert : e.insert.replace(/\n/g, eol)
    }))
    .sort((a, b) => b.from - a.from || b.to - a.to)

  let out = text
  for (const e of resolved) out = out.slice(0, e.from) + e.insert + out.slice(e.to)
  return out
}

/** Type guard the sync listeners use to pick their messages off the channel. */
export function isEditorSyncMessage(msg: unknown): msg is EditorSyncMessage {
  return (
    !!msg &&
    typeof msg === 'object' &&
    typeof (msg as { type?: unknown }).type === 'string' &&
    (msg as { type: string }).type.startsWith('knote:')
  )
}
