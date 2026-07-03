import { create } from 'zustand'

interface ConfirmRequest {
  message: string
  danger: boolean
  resolve: (ok: boolean) => void
}

interface ConfirmState {
  request: ConfirmRequest | null
  answer: (ok: boolean) => void
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  answer: (ok) => {
    get().request?.resolve(ok)
    set({ request: null })
  }
}))

/**
 * In-app replacement for `window.confirm()`. Electron's native confirm
 * dialog leaves the renderer's keyboard input broken until the window
 * loses and regains OS focus, so all confirmations must go through this
 * instead of the blocking browser API.
 */
export function confirm(message: string, opts: { danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.setState({ request: { message, danger: opts.danger ?? false, resolve } })
  })
}
