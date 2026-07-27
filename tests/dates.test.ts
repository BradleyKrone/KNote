import { describe, expect, it } from 'vitest'
import { formatTimeUntil } from '@/shared/dates'

describe('formatTimeUntil', () => {
  const TODAY = '2026-07-08'

  it('names the day itself for the closest three dates', () => {
    expect(formatTimeUntil('2026-07-08', TODAY)).toBe('today')
    expect(formatTimeUntil('2026-07-09', TODAY)).toBe('tomorrow')
    expect(formatTimeUntil('2026-07-07', TODAY)).toBe('yesterday')
  })

  it('counts in days below a week', () => {
    expect(formatTimeUntil('2026-07-11', TODAY)).toBe('in 3 days')
    expect(formatTimeUntil('2026-07-05', TODAY)).toBe('3 days ago')
  })

  it('tiers up to weeks and months as the gap grows', () => {
    expect(formatTimeUntil('2026-07-15', TODAY)).toBe('in 1 week')
    expect(formatTimeUntil('2026-07-29', TODAY)).toBe('in 3 weeks')
    expect(formatTimeUntil('2026-09-06', TODAY)).toBe('in 2 months')
    expect(formatTimeUntil('2026-06-08', TODAY)).toBe('1 month ago')
  })
})
