// One postMessage RPC router shared by every KNote webview: request/response
// dispatch into the HostApi handlers, plus event broadcast (index deltas,
// config changes, active-note tracking) to all attached webviews.

import * as vscode from 'vscode'
import type { HostEvents, RpcRequest, RpcResponse } from '@shared/hostApi'
import { onIndexDelta } from '../engine'
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

/** Wire the host-side event sources into the broadcast channel. Call once at startup. */
export function registerRpcBroadcasts(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    onIndexDelta((delta) => broadcast('indexDelta', delta)),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      broadcast('activeNoteChanged', editor ? relForUri(editor.document.uri) : null)
    })
  )
}
