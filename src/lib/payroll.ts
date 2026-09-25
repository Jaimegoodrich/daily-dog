export type PayrollEntry = {
  pickup_route_id: string | null
  actual_pickup_at: string | null
  dropoff_route_id: string | null
  actual_dropoff_at: string | null
}
export type PayrollRoute = { id: string; date: string; employee_id: string | null; employeeName: string | null }

export type PayrollDay = {
  date: string
  /** First dog picked up that day, or null if none was logged. */
  firstPickup: Date | null
  /** Last dog dropped off that day, or null if none was logged. */
  lastDropoff: Date | null
  /** Time from first pickup to last dropoff, rounded up to the next 15 minutes. 0 if either end is missing. */
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
 * For each employee and date: the time from the first dog they picked up to
 * the last dog they dropped off, rounded up to the nearest 15 minutes. The
 * week's total is the sum of those daily figures. A day missing either end
 * (nothing logged yet) counts as 0 and is flagged so it can be chased up.
 * Seconds are ignored (times compare by the minute), so 8:25:40 -> 2:45:10
 * counts as 6h 20m before rounding up to 6h 30m.
 */
export function computePayroll(entries: PayrollEntry[], routes: PayrollRoute[]): PayrollEmployee[] {
  const routeById = new Map(routes.map((r) => [r.id, r]))
  // employeeId -> date -> logged pickup / dropoff times
  const byEmployee = new Map<string, { name: string; dates: Map<string, { pickups: Date[]; dropoffs: Date[] }> }>()

  function record(routeId: string | null, at: string | null, kind: 'pickups' | 'dropoffs') {
    if (!routeId || !at) return
    const route = routeById.get(routeId)
    if (!route?.employee_id) return
    const emp = byEmployee.get(route.employee_id) ?? { name: route.employeeName ?? 'Unknown', dates: new Map() }
    const day = emp.dates.get(route.date) ?? { pickups: [], dropoffs: [] }
    day[kind].push(new Date(at))
    emp.dates.set(route.date, day)
    byEmployee.set(route.employee_id, emp)
  }

  for (const entry of entries) {
    record(entry.pickup_route_id, entry.actual_pickup_at, 'pickups')
    record(entry.dropoff_route_id, entry.actual_dropoff_at, 'dropoffs')
  }

  const earliest = (times: Date[]) => (times.length ? new Date(Math.min(...times.map((t) => t.getTime()))) : null)
  const latest = (times: Date[]) => (times.length ? new Date(Math.max(...times.map((t) => t.getTime()))) : null)

  return [...byEmployee.entries()]
    .map(([employeeId, { name, dates }]) => {
      const days: PayrollDay[] = [...dates.entries()]
        .map(([date, { pickups, dropoffs }]) => {
          const firstPickup = earliest(pickups)
          const lastDropoff = latest(dropoffs)
          let minutes = 0
          if (firstPickup && lastDropoff) {
            const elapsed = Math.floor(lastDropoff.getTime() / 60000) - Math.floor(firstPickup.getTime() / 60000)
            minutes = Math.max(0, Math.ceil(elapsed / INCREMENT_MINUTES) * INCREMENT_MINUTES)
          }
          return { date, firstPickup, lastDropoff, minutes }
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
