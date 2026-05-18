/** Local calendar date key YYYY-MM-DD (no UTC shift). */
export function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseIsoToLocalDateKey(iso: string | undefined | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return localDateKey(new Date(t))
}

export type DayFilterStop = {
  statusTag: string
  createdAt?: string | null
  deliveredAt?: string | null
  updatedAt?: string | null
}

/**
 * Deliveries for a calendar day:
 * - Delivered: shown on the day they were completed (`deliveredAt`).
 * - Open: shown on assigned day (`createdAt`) and on **today** (full active backlog).
 */
export function stopsForCalendarDay<T extends DayFilterStop>(stops: T[], day: Date, now: Date = new Date()): T[] {
  const key = localDateKey(day)
  const todayKey = localDateKey(now)

  return stops.filter((s) => {
    const createdKey = parseIsoToLocalDateKey(s.createdAt ?? undefined)

    if (s.statusTag === 'Delivered') {
      const doneKey =
        parseIsoToLocalDateKey(s.deliveredAt ?? undefined) ?? parseIsoToLocalDateKey(s.updatedAt ?? undefined)
      if (doneKey) return doneKey === key
      return parseIsoToLocalDateKey(s.createdAt ?? undefined) === key
    }
    if (key === todayKey) return true
    return createdKey === key
  })
}

export function completedCountForCalendarDay<T extends DayFilterStop>(stops: T[], day: Date): number {
  const key = localDateKey(day)
  return stops.filter((s) => {
    if (s.statusTag !== 'Delivered') return false
    const deliveredKey = parseIsoToLocalDateKey(s.deliveredAt ?? undefined)
    const updatedKey = parseIsoToLocalDateKey(s.updatedAt ?? undefined)
    const doneKey = deliveredKey ?? updatedKey
    if (doneKey) return doneKey === key
    return parseIsoToLocalDateKey(s.createdAt ?? undefined) === key
  }).length
}

/** Monday = 0 … Sunday = 6 */
export function startOfWeekMonday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dow)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() + n)
  return x
}

export function addMonthsClampDay(d: Date, deltaMonths: number): Date {
  const y = d.getFullYear()
  const m = d.getMonth()
  const day = d.getDate()
  const target = new Date(y, m + deltaMonths, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(day, last))
  return target
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return localDateKey(a) === localDateKey(b)
}
