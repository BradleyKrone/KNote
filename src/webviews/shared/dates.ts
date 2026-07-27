import dayjs from 'dayjs'

/** Human countdown/countup label for a YYYY-MM-DD date relative to today, tiered by magnitude. */
export function formatTimeUntil(date: string, today: string): string {
  const days = dayjs(date).diff(dayjs(today), 'day')
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'

  const ago = days < 0
  const n = Math.abs(days)
  let amount: number
  let unit: string
  if (n >= 30) {
    amount = Math.round(n / 30)
    unit = amount === 1 ? 'month' : 'months'
  } else if (n >= 7) {
    amount = Math.round(n / 7)
    unit = amount === 1 ? 'week' : 'weeks'
  } else {
    amount = n
    unit = amount === 1 ? 'day' : 'days'
  }
  return ago ? `${amount} ${unit} ago` : `in ${amount} ${unit}`
}
