// One postMessage RPC router shared by every KNote webview: request/response
// dispatch into the HostApi handlers, plus event broadcast (index deltas,
// config changes, active-note tracking) to all attached webviews.

import * as vscode from 'vscode'
import type { HostEvents, RpcRequest, RpcResponse } from '@shared/hostApi'
import { onAttachmentChange, onIndexDelta } from '../engine'
import { relForUri } from '../paths'

export type HostHandlers = Record<string, (...args: never[]) => unknown>

const attached = new Set<vscode.Webview>()

export function attach(webview: vscode.Webview, handlers: HostHandlers): vscode.Disposable {
  attached.add(webview)
  const sub = webview.onDidReceiveMessage(async (msg: RpcRequest) => {
    if (!msg || typeof msg.id !== 'number' || typeof msg.method !== 'string') return
    let response: RpcResponse
    try {
      const fn = handlers[msg.method]
      if (!fn) throw new Error(`Unknown RPC method: ${msg.method}`)
      const result = await (fn as (...args: unknown[]) => unknown)(...(msg.params ?? []))
      response = { id: msg.id, ok: true, result }
    } catch (err) {
      response = {
        id: msg.id,
        ok: false,
        error: { message: err instanceof Error ? err.message : String(err) }
      }
    }
    void webview.postMessage(response)
  })
  return {
    dispose: () => {
      attached.delete(webview)
      sub.dispose()
    }
  }
}

export function broadcast<E extends keyof HostEvents>(event: E, payload: HostEvents[E]): void {
  for (const webview of attached) {
    void webview.postMessage({ event, payload })
  }
}

// Tracked separately from vscode.window.activeTextEditor because that API
// never reflects KNote's Live Preview custom editor (see liveEditorProvider,
// which calls setActiveNote directly on panel focus). Sidebar views read
// this for their bootstrap value so a view that resolves after a Live
// Preview note is already open still starts with the right note.
let currentActiveNote: string | null = null

export function currentActiveNoteRel(): string | null {
  return currentActiveNote
}

export function setActiveNote(path: string | null): void {
  currentActiveNote = path
  broadcast('activeNoteChanged', path)
}

/** Wire the host-side event sources into the broadcast channel. Call once at startup. */
export function registerRpcBroadcasts(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    onIndexDelta((delta) => broadcast('indexDelta', delta)),
    onAttachmentChange((path) => broadcast('attachmentChanged', path)),
    // Fires with `editor === undefined` whenever focus moves to *any*
    // non-TextEditor surface — including KNote's own Live Preview panel,
    // every time it's opened or focused. Only react when there's a real
    // vault-note editor to switch to; clearing to null on a Live Preview
    // note is liveEditorProvider's job (panel dispose), not this listener's
    // — otherwise this fires right after it and clobbers the correct value.
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      const rel = editor ? relForUri(editor.document.uri) : null
      if (rel !== null) setActiveNote(rel)
    })
  )
}
