export type PayrollEntry = {
  pickup_route_id: string | null
  actual_pickup_at: string | null
  dropoff_route_id: string | null
  actual_dropoff_at: string | null
}
export type PayrollRoute = {
  id: string
  date: string
  employee_id: string | null
  employeeName: string | null
  clocked_in_at: string | null
  clocked_out_at: string | null
}

export type PayrollDay = {
  date: string
  /** Earliest clock-in that day, or null if the employee never clocked in. */
  clockIn: Date | null
  /** Latest clock-out that day, or null if any route that day is still clocked in. */
  clockOut: Date | null
  /** Time from clock-in to clock-out, rounded up to the next 15 minutes. 0 if either end is missing. */
  minutes: number
}

export type PayrollEmployee = {
  employeeId: string
  name: string
  days: PayrollDay[]
  totalMinutes: number
}

const INCREMENT_MINUTES = 15

/**
 * For each employee and date: the time from when they clocked in to when they
 * clocked out, rounded up to the nearest 15 minutes. The week's total is the
 * sum of those daily figures. A day missing either end (clocked in but never
 * clocked out) counts as 0 and is flagged so it can be chased up.
 * Seconds are ignored (times compare by the minute), so 8:25:40 -> 2:45:10
 * counts as 6h 20m before rounding up to 6h 30m.
 *
 * Routes run before clock-in existed have no clock times; for those the first
 * pickup and last dropoff stand in, so older weeks still add up.
 */
export function computePayroll(entries: PayrollEntry[], routes: PayrollRoute[]): PayrollEmployee[] {
  // routeId -> logged pickup / dropoff times, for legacy routes with no clock times
  const logged = new Map<string, { pickups: number[]; dropoffs: number[] }>()
  function record(routeId: string | null, at: string | null, kind: 'pickups' | 'dropoffs') {
    if (!routeId || !at) return
    const times = logged.get(routeId) ?? { pickups: [], dropoffs: [] }
    times[kind].push(new Date(at).getTime())
    logged.set(routeId, times)
  }
  for (const entry of entries) {
    record(entry.pickup_route_id, entry.actual_pickup_at, 'pickups')
    record(entry.dropoff_route_id, entry.actual_dropoff_at, 'dropoffs')
  }

  // employeeId -> date -> each route's start / end (null end = not clocked out)
  const byEmployee = new Map<string, { name: string; dates: Map<string, { start: number; end: number | null }[]> }>()

  for (const route of routes) {
    if (!route.employee_id) continue
    let start: number | null
    let end: number | null
    if (route.clocked_in_at) {
      start = new Date(route.clocked_in_at).getTime()
      end = route.clocked_out_at ? new Date(route.clocked_out_at).getTime() : null
    } else {
      const times = logged.get(route.id)
      start = times?.pickups.length ? Math.min(...times.pickups) : null
      end = times?.dropoffs.length ? Math.max(...times.dropoffs) : null
    }
    if (start === null) continue
    const emp = byEmployee.get(route.employee_id) ?? { name: route.employeeName ?? 'Unknown', dates: new Map() }
    const day = emp.dates.get(route.date) ?? []
    day.push({ start, end })
    emp.dates.set(route.date, day)
    byEmployee.set(route.employee_id, emp)
  }

  return [...byEmployee.entries()]
    .map(([employeeId, { name, dates }]) => {
      const days: PayrollDay[] = [...dates.entries()]
        .map(([date, spans]) => {
          const clockIn = new Date(Math.min(...spans.map((s) => s.start)))
          const ends = spans.map((s) => s.end)
          const clockOut = ends.every((e) => e !== null) ? new Date(Math.max(...(ends as number[]))) : null
          let minutes = 0
          if (clockOut) {
            const elapsed = Math.floor(clockOut.getTime() / 60000) - Math.floor(clockIn.getTime() / 60000)
            minutes = Math.max(0, Math.ceil(elapsed / INCREMENT_MINUTES) * INCREMENT_MINUTES)
          }
          return { date, clockIn, clockOut, minutes }
        })
        .sort((a, b) => a.date.localeCompare(b.date))
      return { employeeId, name, days, totalMinutes: days.reduce((sum, d) => sum + d.minutes, 0) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 390 -> "6:30" */
export function formatDuration(minutes: number) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** 390 -> "6.50" */
export function formatDecimalHours(minutes: number) {
  return (minutes / 60).toFixed(2)
}

/** "8:25 AM" in the viewer's local time, or "—" when nothing was logged. */
export function formatClockTime(date: Date | null) {
  return date ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'
}
