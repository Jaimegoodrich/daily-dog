import type { AfterHoursTransport, Client, Dog, ScheduleEntry } from '@/types/database'

export type DogWithClient = Dog & { client: Client | null }
export type StayWithTransports = ScheduleEntry & { transports: AfterHoursTransport[] }

export const REASON_LABELS: Record<string, string> = {
  vet: 'Vet',
  grooming: 'Grooming',
  vacation: 'Vacation',
  injury: 'Injury',
  rain: 'Rain',
  heat: 'Heat',
  admin: 'Admin',
  boarding: 'Boarding',
  other: 'Other',
}

export interface DogStay {
  id: string
  checkIn: string
  checkOut: string
  /** Nights of the stay that fall in the report month (the date each night starts). */
  nights: string[]
  /** Hikes the dog went on during the stay, within the report month. */
  hikes: string[]
  afterHours: { kind: 'pickup' | 'dropoff'; date: string; time: string }[]
}

export interface DogMonthReport {
  dog: DogWithClient
  hikes: string[]
  adds: string[]
  cancellations: { date: string; reason: string; late: boolean }[]
  stays: DogStay[]
  cancelledStays: { checkIn: string; checkOut: string }[]
}

export interface ClientMonthReport {
  clientId: string
  clientName: string
  dogs: DogMonthReport[]
}

export function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` }
}

export function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayOfWeek(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').getDay()
}

function ordinal(n: number) {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

function monthName(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'long' })
}

/** "October 2nd" */
export function formatDay(dateStr: string) {
  return `${monthName(dateStr)} ${ordinal(Number(dateStr.slice(8, 10)))}`
}

/** "October 2nd, 4th, 5th, November 1st" — the month name only where it changes. */
export function formatDayList(dates: string[]) {
  let lastMonth = ''
  return [...dates]
    .sort()
    .map((d) => {
      const m = d.slice(0, 7)
      const day = ordinal(Number(d.slice(8, 10)))
      if (m === lastMonth) return day
      lastMonth = m
      return `${monthName(d)} ${day}`
    })
    .join(', ')
}

export function formatTimeOfDay(time: string) {
  const [h, m] = time.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`
}

export function buildMonthlyReport(
  month: string,
  dogs: DogWithClient[],
  hikes: ScheduleEntry[],
  stays: StayWithTransports[],
  patternByDog: Map<string, Set<number>>
): ClientMonthReport[] {
  const { start, end } = monthBounds(month)
  const byDog = new Map<string, DogMonthReport>()
  const reportFor = (dog: DogWithClient) => {
    let r = byDog.get(dog.id)
    if (!r) {
      r = { dog, hikes: [], adds: [], cancellations: [], stays: [], cancelledStays: [] }
      byDog.set(dog.id, r)
    }
    return r
  }
  const dogById = new Map(dogs.map((d) => [d.id, d]))

  for (const e of hikes) {
    const dog = dogById.get(e.dog_id)
    if (!dog || e.check_in_date < start || e.check_in_date > end) continue
    const r = reportFor(dog)
    if (e.cancelled) {
      // A regular hike replaced by a boarding stay isn't a real cancellation.
      if (e.cancel_reason !== 'boarding') {
        r.cancellations.push({
          date: e.check_in_date,
          reason: REASON_LABELS[e.cancel_reason ?? 'other'],
          late: e.late_cancel,
        })
      }
      continue
    }
    r.hikes.push(e.check_in_date)
    // Hikes a boarding stay adds are covered under the stay, not as adds.
    if (!e.boarding_entry_id && !patternByDog.get(e.dog_id)?.has(dayOfWeek(e.check_in_date))) {
      r.adds.push(e.check_in_date)
    }
  }

  for (const s of stays) {
    const dog = dogById.get(s.dog_id)
    if (!dog || s.check_in_date > end || s.check_out_date < start) continue
    const r = reportFor(dog)
    if (s.cancelled) {
      r.cancelledStays.push({ checkIn: s.check_in_date, checkOut: s.check_out_date })
      continue
    }
    const nights: string[] = []
    for (let d = s.check_in_date; d < s.check_out_date; d = addDays(d, 1)) {
      if (d >= start && d <= end) nights.push(d)
    }
    const stayHikes = hikes
      .filter(
        (h) =>
          h.dog_id === s.dog_id &&
          !h.cancelled &&
          h.check_in_date >= s.check_in_date &&
          h.check_in_date <= s.check_out_date &&
          h.check_in_date >= start &&
          h.check_in_date <= end
      )
      .map((h) => h.check_in_date)
      .sort()
    const afterHours = (s.transports ?? [])
      .filter((t) => t.date >= start && t.date <= end)
      .map((t) => ({ kind: t.kind, date: t.date, time: t.time }))
      .sort((a, b) => a.date.localeCompare(b.date))
    r.stays.push({ id: s.id, checkIn: s.check_in_date, checkOut: s.check_out_date, nights, hikes: stayHikes, afterHours })
  }

  const byClient = new Map<string, ClientMonthReport>()
  for (const r of byDog.values()) {
    r.hikes.sort()
    r.adds.sort()
    r.cancellations.sort((a, b) => a.date.localeCompare(b.date))
    r.stays.sort((a, b) => a.checkIn.localeCompare(b.checkIn))
    const clientId = r.dog.client_id
    let c = byClient.get(clientId)
    if (!c) {
      c = { clientId, clientName: r.dog.client?.main_name ?? 'Unknown client', dogs: [] }
      byClient.set(clientId, c)
    }
    c.dogs.push(r)
  }
  const clients = [...byClient.values()]
  for (const c of clients) c.dogs.sort((a, b) => a.dog.name.localeCompare(b.dog.name))
  return clients.sort((a, b) => a.clientName.localeCompare(b.clientName))
}

/** The plain-text paragraph for one dog, e.g. "Mosley: October 2nd, 4th. Cancelled October 9th due to Vet." */
export function dogReportLines(r: DogMonthReport): string[] {
  const lines: string[] = []
  lines.push(
    r.hikes.length > 0
      ? `${r.dog.name}: ${formatDayList(r.hikes)} (${r.hikes.length} hike${r.hikes.length === 1 ? '' : 's'}).`
      : `${r.dog.name}: No hikes this month.`
  )
  if (r.adds.length > 0) {
    lines.push(`Added outside the regular schedule: ${formatDayList(r.adds)}.`)
  }
  for (const c of r.cancellations) {
    lines.push(`Cancelled ${formatDay(c.date)} due to ${c.reason}${c.late ? ' (late cancel)' : ''}.`)
  }
  for (const s of r.stays) {
    const nightCount = s.nights.length
    lines.push(
      `Boarded ${formatDay(s.checkIn)} – ${formatDay(s.checkOut)}: ` +
        (nightCount > 0
          ? `${nightCount} overnight${nightCount === 1 ? '' : 's'} this month (nights of ${formatDayList(s.nights)}).`
          : 'no overnights this month.')
    )
    if (s.hikes.length > 0) lines.push(`  Hikes during the stay: ${formatDayList(s.hikes)}.`)
    for (const t of s.afterHours) {
      lines.push(`  After-hours ${t.kind} ${formatDay(t.date)} at ${formatTimeOfDay(t.time)}.`)
    }
  }
  for (const s of r.cancelledStays) {
    lines.push(`Boarding ${formatDay(s.checkIn)} – ${formatDay(s.checkOut)} was cancelled.`)
  }
  return lines
}
