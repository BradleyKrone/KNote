// Vitest global setup.
//
// Webview modules reach the extension host through shared/rpc.ts, which at
// module scope calls `acquireVsCodeApi()` — a function VS Code injects into the
// webview — and registers a `window` message listener. Neither exists under
// Node, so importing any webview module that transitively touches the RPC
// client (the stores, completions, the editor extensions built on them) throws
// at import time, putting them out of reach of unit tests entirely.
//
// This is the smallest stub that makes those modules importable. It is not a
// mock and nothing here should be asserted on: there is no DOM, so anything
// that actually renders belongs in test/ (the VS Code integration harness).

interface StubVsCodeApi {
  postMessage: (msg: unknown) => void
  getState: () => unknown
  setState: (s: unknown) => void
}

const api: StubVsCodeApi = {
  postMessage: () => {},
  getState: () => undefined,
  setState: () => {}
}

const g = globalThis as {
  acquireVsCodeApi?: () => StubVsCodeApi
  window?: unknown
}

g.acquireVsCodeApi = () => api
g.window ??= { addEventListener: () => {}, removeEventListener: () => {} }
