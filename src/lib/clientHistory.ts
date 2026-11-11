import type { AfterHoursTransport, Dog, Employee, Route, ScheduleEntry } from '@/types/database'
import { REASON_LABELS, addDays, formatTimeOfDay } from '@/lib/monthlyReport'

type RouteWithEmployee = Pick<Route, 'route_number'> & { employee: Pick<Employee, 'display_name'> | null }

export type HistoryHike = ScheduleEntry & {
  dog: Pick<Dog, 'id' | 'name'>
  pickup_route: RouteWithEmployee | null
  dropoff_route: RouteWithEmployee | null
}

export type HistoryStay = ScheduleEntry & {
  dog: Pick<Dog, 'id' | 'name'>
  transports: (AfterHoursTransport & { employee: Pick<Employee, 'display_name'> | null })[]
}

/** One line of the history: something that happened (or was scheduled) for one dog on one date. */
export interface HistoryRow {
  date: string
  dogName: string
  /** e.g. "Hike", "Hike (boarding)", "Overnight boarding", "Cancelled hike" */
  service: string
  pickup: string
  dropoff: string
  /** Who did it, e.g. "Route 2 · Sam" */
  by: string
  notes: string
  cancelled: boolean
}

export interface ClientHistory {
  rows: HistoryRow[]
  hikes: number
  overnights: number
  cancellations: number
  lateCancellations: number
}

/** "Wed, Nov 4, 2026" */
export function formatHistoryDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** A logged timestamp as a local clock time, e.g. "8:14 AM". */
function loggedTime(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** The logged time, or what was scheduled when nothing was logged. */
function timeCell(logged: string | null, scheduled: string | null, where?: string) {
  const at = where ? ` (${where})` : ''
  const t = loggedTime(logged)
  if (t) return `${t}${at}`
  return scheduled ? `Not logged — scheduled ${formatTimeOfDay(scheduled)}${at}` : `Not logged${at}`
}

function routeLabel(r: RouteWithEmployee | null) {
  if (!r) return ''
  return `Route ${r.route_number}${r.employee ? ` · ${r.employee.display_name}` : ''}`
}

function joinBy(...parts: string[]) {
  return [...new Set(parts.filter(Boolean))].join(' / ')
}

export function buildClientHistory(
  start: string,
  end: string,
  hikes: HistoryHike[],
  stays: HistoryStay[]
): ClientHistory {
  const rows: HistoryRow[] = []
  let hikeCount = 0
  let overnights = 0
  let cancellations = 0
  let lateCancellations = 0

  for (const e of hikes) {
    if (e.check_in_date < start || e.check_in_date > end) continue
    if (e.cancelled) {
      const replacedByBoarding = e.cancel_reason === 'boarding'
      if (!replacedByBoarding) {
        cancellations++
        if (e.late_cancel) lateCancellations++
      }
      rows.push({
        date: e.check_in_date,
        dogName: e.dog.name,
        service: 'Cancelled hike',
        pickup: '—',
        dropoff: '—',
        by: '',
        notes: replacedByBoarding
          ? 'Replaced by boarding stay'
          : `Reason: ${REASON_LABELS[e.cancel_reason ?? 'other']}${e.late_cancel ? ' (late cancel)' : ''}`,
        cancelled: true,
      })
      continue
    }
    const duringStay = !!e.boarding_entry_id || e.pickup_at_jaimes || e.dropoff_at_jaimes
    // Hikes during a boarding stay are included in the boarding, matching the monthly report.
    if (!duringStay) hikeCount++
    const notes = [
      e.pickup_issue_notes && `Pickup: ${e.pickup_issue_notes}`,
      e.dropoff_issue_notes && `Dropoff: ${e.dropoff_issue_notes}`,
      e.late_pickup_by_owner && 'Owner picked up late',
    ].filter(Boolean)
    rows.push({
      date: e.check_in_date,
      dogName: e.dog.name,
      service: duringStay ? 'Hike (boarding)' : 'Hike',
      pickup: timeCell(e.actual_pickup_at, e.scheduled_pickup_time, e.pickup_at_jaimes ? "at Jaime's" : undefined),
      dropoff: timeCell(
        e.actual_dropoff_at,
        e.scheduled_dropoff_time,
        e.dropoff_at_jaimes ? "at Jaime's" : undefined
      ),
      by: joinBy(routeLabel(e.pickup_route), routeLabel(e.dropoff_route)),
      notes: notes.join(' · '),
      cancelled: false,
    })
  }

  for (const s of stays) {
    if (s.check_in_date > end || s.check_out_date < start) continue
    const stayLabel = `Stay ${formatHistoryDate(s.check_in_date)} – ${formatHistoryDate(s.check_out_date)}`
    if (s.cancelled) {
      rows.push({
        date: s.check_in_date < start ? start : s.check_in_date,
        dogName: s.dog.name,
        service: 'Cancelled boarding',
        pickup: '—',
        dropoff: '—',
        by: '',
        notes: stayLabel,
        cancelled: true,
      })
      continue
    }
    for (let d = s.check_in_date; d < s.check_out_date; d = addDays(d, 1)) {
      if (d < start || d > end) continue
      overnights++
      rows.push({
        date: d,
        dogName: s.dog.name,
        service: 'Overnight boarding',
        pickup: '',
        dropoff: '',
        by: '',
        notes: [stayLabel, d === s.check_in_date && s.belongings_notes && `Belongings: ${s.belongings_notes}`]
          .filter(Boolean)
          .join(' · '),
        cancelled: false,
      })
    }
    // Stays booked before every boarding day became a hike carried their
    // check-in pickup and check-out dropoff on the stay itself.
    if (s.actual_pickup_at && s.check_in_date >= start && s.check_in_date <= end) {
      rows.push({
        date: s.check_in_date,
        dogName: s.dog.name,
        service: 'Boarding check-in',
        pickup: timeCell(s.actual_pickup_at, s.scheduled_pickup_time),
        dropoff: '',
        by: '',
        notes: s.pickup_issue_notes ?? '',
        cancelled: false,
      })
    }
    if (s.actual_dropoff_at && s.check_out_date >= start && s.check_out_date <= end) {
      rows.push({
        date: s.check_out_date,
        dogName: s.dog.name,
        service: 'Boarding check-out',
        pickup: '',
        dropoff: timeCell(s.actual_dropoff_at, s.scheduled_dropoff_time),
        by: '',
        notes: s.dropoff_issue_notes ?? '',
        cancelled: false,
      })
    }
    for (const t of s.transports ?? []) {
      if (t.date < start || t.date > end) continue
      const cell = timeCell(t.status === 'done' ? t.completed_at : null, t.time)
      rows.push({
        date: t.date,
        dogName: s.dog.name,
        service: `After-hours ${t.kind}`,
        pickup: t.kind === 'pickup' ? cell : '',
        dropoff: t.kind === 'dropoff' ? cell : '',
        by: t.employee?.display_name ?? '',
        notes: `Scheduled ${formatTimeOfDay(t.time)}`,
        cancelled: false,
      })
    }
  }

  const order = (r: HistoryRow) => (r.service.startsWith('Overnight') ? 1 : 0)
  rows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.dogName.localeCompare(b.dogName) || order(a) - order(b)
  )
  return { rows, hikes: hikeCount, overnights, cancellations, lateCancellations }
}

export function historySummary(h: ClientHistory) {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const parts = [plural(h.hikes, 'hike'), plural(h.overnights, 'boarding overnight'), plural(h.cancellations, 'cancellation')]
  if (h.lateCancellations > 0) parts.push(`${h.lateCancellations} late`)
  return parts.join(' · ')
}
