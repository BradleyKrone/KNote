// Webview-side RPC client: typed calls into the extension host (HostApi)
// plus event subscription. One instance per webview.

import type { HostApi, HostEvents, RpcEvent, RpcResponse } from '@shared/hostApi'

interface VsCodeApi {
  postMessage(msg: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

declare function acquireVsCodeApi(): VsCodeApi

export const vscodeApi = acquireVsCodeApi()

let nextId = 1
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
const listeners = new Map<string, Set<(payload: never) => void>>()

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as RpcResponse | RpcEvent
  if (msg && typeof msg === 'object' && 'id' in msg) {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.result)
    else p.reject(new Error(msg.error.message))
    return
  }
  if (msg && typeof msg === 'object' && 'event' in msg) {
    const subs = listeners.get(msg.event)
    if (subs) for (const cb of subs) (cb as (payload: unknown) => void)(msg.payload)
  }
})

function call(method: string, ...params: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    vscodeApi.postMessage({ id, method, params })
  })
}

/** Typed proxy over the HostApi — `host.searchVault('foo')` etc. */
export const host: HostApi = new Proxy({} as HostApi, {
  get: (_t, method: string) => {
    return (...params: unknown[]) => call(method, ...params)
  }
})

/** Subscribe to a host-pushed event. Returns unsubscribe. */
export function on<E extends keyof HostEvents>(
  event: E,
  cb: (payload: HostEvents[E]) => void
): () => void {
  let subs = listeners.get(event)
  if (!subs) {
    subs = new Set()
    listeners.set(event, subs)
  }
  subs.add(cb as (payload: never) => void)
  return () => subs.delete(cb as (payload: never) => void)
}

/** The bootstrap payload embedded in the webview HTML by the host. */
export function bootstrap<T>(): T {
  return ((window as unknown as Record<string, unknown>).__KNOTE_BOOTSTRAP__ ?? {}) as T
}
