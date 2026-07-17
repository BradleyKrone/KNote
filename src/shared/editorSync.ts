// Message protocol between the live-preview editor webview (CodeMirror) and
// its CustomTextEditorProvider host (src/extension/views/liveEditorProvider.ts).
//
// These ride the same webview.postMessage channel as the HostApi RPC, but
// carry a `type` discriminator instead of the RPC `id`/`method`/`event`
// shape, so the RPC router (webviewRpc.attach) and the RPC client
// (webviews/shared/rpc.ts) both ignore them and only the sync glue reacts.

/** A single replacement, in the pre-change document's character offsets. */
export interface CmEdit {
  from: number
  to: number
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

export type EditorSyncMessage = CmEditsMessage | HostUpdateMessage | RevealLineMessage

/**
 * The single minimal replacement that turns `current` into `next`, found by
 * trimming their common prefix and suffix. Applying only this span (rather than
 * replacing the whole document) keeps every position outside it — and the
 * editor's scroll anchor — fixed when the host pushes an updated note back.
 * Returns a no-op edit (an empty range with an empty insert) when they're
 * identical — though callers should short-circuit equal strings before calling.
 */
export function diffEdit(current: string, next: string): CmEdit {
  let from = 0
  const max = Math.min(current.length, next.length)
  while (from < max && current.charCodeAt(from) === next.charCodeAt(from)) from++
  let toOld = current.length
  let toNew = next.length
  while (toOld > from && toNew > from && current.charCodeAt(toOld - 1) === next.charCodeAt(toNew - 1)) {
    toOld--
    toNew--
  }
  return { from, to: toOld, insert: next.slice(from, toNew) }
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
