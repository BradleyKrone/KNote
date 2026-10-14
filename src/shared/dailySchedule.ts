// A once-a-day wall-clock trigger, used to bring KNote Home up each morning.
//
// Rather than one long setTimeout aimed at the target time — which drifts or
// never fires across sleep, DST and clock changes — the host polls and asks
// whether the target time was crossed between its last check and now. A
// machine asleep at 4:00 therefore still fires when it wakes. Pure, so the
// host timer and the unit tests share it.

export interface DailyTime {
  hour: number
  minute: number
}

/** `"HH:MM"` (24h) → the time; anything else (including `""`) → null, meaning off. */
export function parseDailyTime(s: string | undefined): DailyTime | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(s ?? '')
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

/** The latest occurrence of `t` at or before `now`, in local time. */
function latestOccurrence(now: Date, t: DailyTime): Date {
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.hour, t.minute)
  if (at > now) at.setDate(at.getDate() - 1)
  return at
}

/** Whether `t` fell in the window `(prev, now]`. */
export function crossedDailyTime(prev: Date, now: Date, t: DailyTime): boolean {
  if (now <= prev) return false
  return latestOccurrence(now, t) > prev
}
