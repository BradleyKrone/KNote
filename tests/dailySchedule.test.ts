import { describe, expect, it } from 'vitest'
import { crossedDailyTime, parseDailyTime } from '@shared/dailySchedule'

const FOUR = { hour: 4, minute: 0 }
const at = (day: number, h: number, m = 0): Date => new Date(2026, 9, day, h, m)

describe('parseDailyTime', () => {
  it('reads HH:MM', () => {
    expect(parseDailyTime('04:00')).toEqual({ hour: 4, minute: 0 })
    expect(parseDailyTime('4:30')).toEqual({ hour: 4, minute: 30 })
    expect(parseDailyTime('23:59')).toEqual({ hour: 23, minute: 59 })
  })

  it('treats empty or invalid as off', () => {
    expect(parseDailyTime('')).toBeNull()
    expect(parseDailyTime(undefined)).toBeNull()
    expect(parseDailyTime('24:00')).toBeNull()
    expect(parseDailyTime('04:60')).toBeNull()
    expect(parseDailyTime('4am')).toBeNull()
  })
})

describe('crossedDailyTime', () => {
  it('fires when the minute ticks onto the target', () => {
    expect(crossedDailyTime(at(13, 3, 59), at(13, 4, 0), FOUR)).toBe(true)
  })

  it('does not fire again later the same morning', () => {
    expect(crossedDailyTime(at(13, 4, 0), at(13, 4, 1), FOUR)).toBe(false)
    expect(crossedDailyTime(at(13, 4, 1), at(13, 4, 2), FOUR)).toBe(false)
  })

  it('does not fire just before the target', () => {
    expect(crossedDailyTime(at(13, 3, 58), at(13, 3, 59), FOUR)).toBe(false)
  })

  it('fires on wake after sleeping through the target', () => {
    expect(crossedDailyTime(at(12, 23), at(13, 9), FOUR)).toBe(true)
  })

  it('fires when days have passed', () => {
    expect(crossedDailyTime(at(10, 12), at(13, 2), FOUR)).toBe(true)
  })

  it('ignores a clock that went backwards', () => {
    expect(crossedDailyTime(at(13, 5), at(13, 3), FOUR)).toBe(false)
  })
})
