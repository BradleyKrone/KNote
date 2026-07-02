import type { KnoteApi } from '../shared/ipc'

declare global {
  interface Window {
    knote: KnoteApi
  }
}

export {}
