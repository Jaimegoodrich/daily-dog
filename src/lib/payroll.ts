export type PayrollEntry = { pickup_route_id: string | null; actual_pickup_at: string | null }
export type PayrollRoute = { id: string; date: string; employee_id: string | null; employeeName: string | null }

export type PayrollDay = {
  date: string
  firstPickup: Date
  lastPickup: Date
  pickupCount: number
  /** Time between first and last pickup, rounded up to the next 15 minutes. */
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
 * For each employee and date: the time from their first to last logged
 * pickup, rounded up to the nearest 15 minutes. The week's total is the sum
 * of those daily figures. Seconds are ignored (times compare by the minute),
 * so 8:25:40 -> 2:45:10 counts as 6h 20m before rounding up to 6h 30m.
 */
export function computePayroll(entries: PayrollEntry[], routes: PayrollRoute[]): PayrollEmployee[] {
  const routeById = new Map(routes.map((r) => [r.id, r]))
  // employeeId -> date -> pickup times
  const byEmployee = new Map<string, { name: string; dates: Map<string, Date[]> }>()

  for (const entry of entries) {
    if (!entry.pickup_route_id || !entry.actual_pickup_at) continue
    const route = routeById.get(entry.pickup_route_id)
    if (!route?.employee_id) continue
    const emp = byEmployee.get(route.employee_id) ?? {
      name: route.employeeName ?? 'Unknown',
      dates: new Map<string, Date[]>(),
    }
    const times = emp.dates.get(route.date) ?? []
    times.push(new Date(entry.actual_pickup_at))
    emp.dates.set(route.date, times)
    byEmployee.set(route.employee_id, emp)
  }

  return [...byEmployee.entries()]
    .map(([employeeId, { name, dates }]) => {
      const days: PayrollDay[] = [...dates.entries()]
        .map(([date, times]) => {
          const sorted = times.sort((a, b) => a.getTime() - b.getTime())
          const firstPickup = sorted[0]
          const lastPickup = sorted[sorted.length - 1]
          const elapsed = Math.floor(lastPickup.getTime() / 60000) - Math.floor(firstPickup.getTime() / 60000)
          const minutes = Math.ceil(elapsed / INCREMENT_MINUTES) * INCREMENT_MINUTES
          return { date, firstPickup, lastPickup, pickupCount: sorted.length, minutes }
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

/** "8:25 AM" in the viewer's local time. */
export function formatClockTime(date: Date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
