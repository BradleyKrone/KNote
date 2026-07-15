// Zustand stores shared by every KNote webview: the note-index mirror
// (hydrated once, patched by indexDelta events), the vault config, a toast,
// and the confirm / reason-prompt dialog queues.

import { create } from 'zustand'
import dayjs from 'dayjs'
import type { IndexDelta, NoteMeta, VaultConfig } from '@shared/types'
import { DEFAULT_VAULT_CONFIG } from '@shared/types'
import { host, on } from './rpc'

// ---------- Index ----------

interface IndexState {
  /** Replaced (new Map) on every change so selectors re-run. */
  notes: Map<string, NoteMeta>
  hydrate: () => Promise<void>
  applyDelta: (delta: IndexDelta) => void
}

export const useIndexStore = create<IndexState>((set, get) => ({
  notes: new Map(),
  hydrate: async () => {
    const snapshot = await host.getIndexSnapshot()
    set({ notes: new Map(snapshot.map((m) => [m.path, m])) })
  },
  applyDelta: (delta) => {
    const notes = new Map(get().notes)
    if (delta.meta === null) notes.delete(delta.path)
    else notes.set(delta.path, delta.meta)
    set({ notes })
  }
}))

// ---------- Vault config ----------

interface ConfigState {
  vaultConfig: VaultConfig
  load: () => Promise<void>
}

export const useConfigStore = create<ConfigState>((set) => ({
  vaultConfig: DEFAULT_VAULT_CONFIG,
  load: async () => {
    set({ vaultConfig: await host.getVaultConfig() })
  }
}))

// ---------- Toast ----------

interface ToastState {
  message: string | null
  showToast: (message: string) => void
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  showToast: (message) => {
    set({ message })
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => set({ message: null }), 2500)
  }
}))

export function showToast(message: string): void {
  useToastStore.getState().showToast(message)
}

// ---------- Confirm dialog ----------

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

/** In-webview replacement for window.confirm() (blocked inside VS Code webviews). */
export function confirm(message: string, opts: { danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.setState({ request: { message, danger: opts.danger ?? false, resolve } })
  })
}

// ---------- Reason prompt ----------

export interface ReasonResult {
  date: string
  reason: string
}

interface ReasonRequest {
  columnName: string
  resolve: (result: ReasonResult | null) => void
}

interface ReasonPromptState {
  request: ReasonRequest | null
  answer: (result: ReasonResult | null) => void
}

export const useReasonPromptStore = create<ReasonPromptState>((set, get) => ({
  request: null,
  answer: (result) => {
    get().request?.resolve(result)
    set({ request: null })
  }
}))

/**
 * Blocks a column move until the user supplies a reason + date. Resolves
 * `null` if the user cancels, which callers must treat as "abort the move."
 */
export function promptReason(columnName: string): Promise<ReasonResult | null> {
  return new Promise((resolve) => {
    useReasonPromptStore.setState({ request: { columnName, resolve } })
  })
}

export function defaultReasonDate(): string {
  return dayjs().format('YYYY-MM-DD')
}

// ---------- Startup ----------

/** Hydrate the stores and wire host events. Call once from each view's main.tsx. */
export function initStores(): void {
  void useIndexStore.getState().hydrate()
  void useConfigStore.getState().load()
  on('indexDelta', (delta) => useIndexStore.getState().applyDelta(delta))
  on('configChanged', (config) => useConfigStore.setState({ vaultConfig: config }))
}
