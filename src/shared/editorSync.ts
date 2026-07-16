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

export type EditorSyncMessage = CmEditsMessage | HostUpdateMessage

/** Type guard the sync listeners use to pick their messages off the channel. */
export function isEditorSyncMessage(msg: unknown): msg is EditorSyncMessage {
  return (
    !!msg &&
    typeof msg === 'object' &&
    typeof (msg as { type?: unknown }).type === 'string' &&
    (msg as { type: string }).type.startsWith('knote:')
  )
}
