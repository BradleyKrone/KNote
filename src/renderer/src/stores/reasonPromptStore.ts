import { create } from 'zustand'
import dayjs from 'dayjs'

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
 * Blocks a column move until the user supplies a reason + date, so a task
 * parked in a column like Waiting always says why and since when. Resolves
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
