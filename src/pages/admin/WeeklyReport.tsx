import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { downloadCSV, downloadText } from '@/lib/csv'
import { computePayroll, formatClockTime, formatDecimalHours, formatDuration } from '@/lib/payroll'
import type { DailyReport, Dog, Employee, Route, ScheduleEntry } from '@/types/database'

const WEEKDAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

type EntryWithDog = ScheduleEntry & { dog: Dog }
type RouteWithEmployee = Route & { employee: Employee | null }
type ReportWithEmployee = DailyReport & { employee: Employee | null }

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function dayOfWeek(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').getDay()
}

function startOfWeek(dateStr: string) {
  return addDays(dateStr, -dayOfWeek(dateStr))
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('default', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

const REASON_LABELS: Record<string, string> = {
  vet: 'Vet',
  grooming: 'Grooming',
  vacation: 'Vacation',
  injury: 'Injury',
  rain: 'Rain',
  heat: 'Heat',
  admin: 'Admin',
  other: 'Other',
}

export function WeeklyReport() {
  const [weekStart, setWeekStart] = useState(startOfWeek(todayStr()))
  const [entries, setEntries] = useState<EntryWithDog[] | null>(null)
  const [routes, setRoutes] = useState<RouteWithEmployee[]>([])
  const [reports, setReports] = useState<ReportWithEmployee[]>([])
  const [patternByDog, setPatternByDog] = useState<Map<string, Set<number>>>(new Map())
  const [loading, setLoading] = useState(true)

  const weekEnd = addDays(weekStart, 6)
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: entryData }, { data: routeData }, { data: reportData }, { data: patternData }] =
        await Promise.all([
          supabase
            .from('schedule_entries')
            .select('*, dog:dogs(*)')
            .eq('type', 'hike')
            .gte('check_in_date', weekStart)
            .lte('check_in_date', weekEnd),
          supabase
            .from('routes')
            .select('*, employee:employees(*)')
            .gte('date', weekStart)
            .lte('date', weekEnd)
            .order('date')
            .order('route_number'),
          supabase
            .from('daily_reports')
            .select('*, employee:employees(*)')
            .gte('date', weekStart)
            .lte('date', weekEnd),
          supabase.from('dog_weekly_pattern').select('*'),
        ])

      const patternMap = new Map<string, Set<number>>()
      for (const p of patternData ?? []) {
        if (!patternMap.has(p.dog_id)) patternMap.set(p.dog_id, new Set())
        patternMap.get(p.dog_id)!.add(p.day_of_week)
      }

      setEntries((entryData as EntryWithDog[] | null) ?? [])
      setRoutes((routeData as RouteWithEmployee[] | null) ?? [])
      setReports((reportData as ReportWithEmployee[] | null) ?? [])
      setPatternByDog(patternMap)
      setLoading(false)
    }
    load()
  }, [weekStart, weekEnd])

  if (loading || entries === null) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  const cancellations = entries
    .filter((e) => e.cancelled)
    .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date) || a.dog.name.localeCompare(b.dog.name))

  const adds = entries
    .filter((e) => !e.cancelled && !patternByDog.get(e.dog_id)?.has(dayOfWeek(e.check_in_date)))
    .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date) || a.dog.name.localeCompare(b.dog.name))

  const entryIssues = entries
    .flatMap((e) => [
      e.pickup_issue_notes ? { date: e.check_in_date, dog: e.dog.name, type: 'Pickup', note: e.pickup_issue_notes } : null,
      e.dropoff_issue_notes
        ? { date: e.check_in_date, dog: e.dog.name, type: 'Dropoff', note: e.dropoff_issue_notes }
        : null,
    ])
    .filter((x): x is { date: string; dog: string; type: string; note: string } => x !== null)

  const reportIssues = reports
    .flatMap((r) => {
      const route = routes.find((rt) => rt.id === r.route_id)
      const label = `${r.employee?.display_name ?? 'Unknown'} — Route ${route?.route_number ?? '?'}`
      return [
        r.van_issues ? { date: r.date, source: label, type: 'Van', note: r.van_issues } : null,
        r.farm_issues ? { date: r.date, source: label, type: 'Farm', note: r.farm_issues } : null,
        r.client_issues ? { date: r.date, source: label, type: 'Client', note: r.client_issues } : null,
      ]
    })
    .filter((x): x is { date: string; source: string; type: string; note: string } => x !== null)

  const dogNames = new Map<string, string>()
  for (const e of entries) dogNames.set(e.dog_id, e.dog.name)
  const dogIds = [...dogNames.keys()].sort((a, b) => dogNames.get(a)!.localeCompare(dogNames.get(b)!))

  const payroll = computePayroll(
    entries,
    routes.map((r) => ({
      id: r.id,
      date: r.date,
      employee_id: r.employee_id,
      employeeName: r.employee?.display_name ?? null,
    }))
  )

  function handleExport() {
    const allEntries = entries ?? []
    const rows: unknown[][] = [
      ['Daily Dog — Weekly Report'],
      [`${weekStart} to ${weekEnd}`],
      [],
      ['CANCELLATIONS'],
      ['Date', 'Dog', 'Reason', 'Late Cancel'],
      ...cancellations.map((e) => [
        e.check_in_date,
        e.dog.name,
        REASON_LABELS[e.cancel_reason ?? 'other'],
        e.late_cancel ? 'Yes' : 'No',
      ]),
      [],
      ['ADDS'],
      ['Date', 'Dog'],
      ...adds.map((e) => [e.check_in_date, e.dog.name]),
      [],
      ['ISSUES'],
      ['Date', 'Source', 'Type', 'Note'],
      ...reportIssues.map((r) => [r.date, r.source, r.type, r.note]),
      ...entryIssues.map((e) => [e.date, e.dog, e.type, e.note]),
      [],
      ['DOGS BY DAY & ROUTE'],
      ['Date', 'Employee', 'Route', 'Dogs'],
      ...weekDates.flatMap((date) =>
        routes
          .filter((r) => r.date === date)
          .map((route) => {
            const dogs = allEntries
              .filter((e) => e.pickup_route_id === route.id)
              .sort((a, b) => (a.pickup_route_order ?? 0) - (b.pickup_route_order ?? 0))
              .map((e) => e.dog.name)
            return [date, route.employee?.display_name ?? 'Unassigned', route.route_number, dogs.join('; ')]
          })
      ),
      [],
      ['DOGS BY DOG'],
      ['Dog', ...weekDates.map((d) => formatDate(d))],
      ...dogIds.map((dogId) => [
        dogNames.get(dogId),
        ...weekDates.map((date) => {
          const entry = allEntries.find((e) => e.dog_id === dogId && e.check_in_date === date)
          if (!entry) return ''
          if (entry.cancelled) return `Cancelled: ${REASON_LABELS[entry.cancel_reason ?? 'other']}`
          return 'Scheduled'
        }),
      ]),
      [],
      ['PAYROLL'],
      ['Employee', 'Date', 'First Pickup', 'Last Dropoff', 'Hours (h:mm)', 'Hours (decimal)'],
      ...payroll.flatMap((emp) => [
        ...emp.days.map((d) => [
          emp.name,
          d.date,
          formatClockTime(d.firstPickup),
          formatClockTime(d.lastDropoff),
          d.firstPickup && d.lastDropoff ? formatDuration(d.minutes) : 'INCOMPLETE',
          d.firstPickup && d.lastDropoff ? formatDecimalHours(d.minutes) : '',
        ]),
        [emp.name, 'WEEK TOTAL', '', '', formatDuration(emp.totalMinutes), formatDecimalHours(emp.totalMinutes)],
      ]),
    ]
    downloadCSV(`weekly-report-${weekStart}.csv`, rows)
  }

  function handleExportText() {
    const allEntries = entries ?? []
    const lines: string[] = []
    lines.push('Daily Dog — Weekly Report')
    lines.push(`${formatDate(weekStart)} to ${formatDate(weekEnd)}`)
    lines.push('')

    lines.push(`CANCELLATIONS (${cancellations.length})`)
    if (cancellations.length === 0) lines.push('  None')
    for (const e of cancellations) {
      lines.push(
        `  ${formatDate(e.check_in_date)} — ${e.dog.name}: ${REASON_LABELS[e.cancel_reason ?? 'other']}${e.late_cancel ? ' (LATE CANCEL)' : ''}`
      )
    }
    lines.push('')

    lines.push(`ADDS (${adds.length})`)
    if (adds.length === 0) lines.push('  None')
    for (const e of adds) {
      lines.push(`  ${formatDate(e.check_in_date)} — ${e.dog.name} added outside their regular schedule`)
    }
    lines.push('')

    lines.push(`ISSUES (${entryIssues.length + reportIssues.length})`)
    if (entryIssues.length === 0 && reportIssues.length === 0) lines.push('  None')
    for (const r of reportIssues) lines.push(`  ${formatDate(r.date)} — ${r.source} (${r.type}): ${r.note}`)
    for (const e of entryIssues) lines.push(`  ${formatDate(e.date)} — ${e.dog} (${e.type}): ${e.note}`)
    lines.push('')

    lines.push('DOGS BY DAY & ROUTE')
    for (const date of weekDates) {
      const dayRoutes = routes.filter((r) => r.date === date)
      if (dayRoutes.length === 0) continue
      lines.push(`  ${formatDate(date)}`)
      for (const route of dayRoutes) {
        const dogs = allEntries
          .filter((e) => e.pickup_route_id === route.id)
          .sort((a, b) => (a.pickup_route_order ?? 0) - (b.pickup_route_order ?? 0))
          .map((e) => e.dog.name)
        lines.push(
          `    ${route.employee?.display_name ?? 'Unassigned'} — Route ${route.route_number}: ${dogs.length > 0 ? dogs.join(', ') : 'no dogs'}`
        )
      }
    }
    lines.push('')

    lines.push('DOGS BY DOG')
    for (const dogId of dogIds) {
      const perDay = weekDates.map((date) => {
        const entry = allEntries.find((e) => e.dog_id === dogId && e.check_in_date === date)
        if (!entry) return '—'
        if (entry.cancelled) return `${REASON_LABELS[entry.cancel_reason ?? 'other']} (cancelled)`
        return 'Scheduled'
      })
      lines.push(
        `  ${dogNames.get(dogId)}: ${weekDates.map((d, i) => `${WEEKDAY_SHORT[dayOfWeek(d)]} ${perDay[i]}`).join(', ')}`
      )
    }

    lines.push('')
    lines.push('PAYROLL (first pickup to last dropoff, rounded up to 15 min)')
    if (payroll.length === 0) lines.push('  No pickups logged')
    for (const emp of payroll) {
      lines.push(`  ${emp.name}`)
      for (const d of emp.days) {
        lines.push(
          d.firstPickup && d.lastDropoff
            ? `    ${formatDate(d.date)}: ${formatClockTime(d.firstPickup)} – ${formatClockTime(d.lastDropoff)} = ${formatDuration(d.minutes)} (${formatDecimalHours(d.minutes)} hrs)`
            : `    ${formatDate(d.date)}: ${formatClockTime(d.firstPickup)} – ${formatClockTime(d.lastDropoff)} INCOMPLETE (${d.firstPickup ? 'no dropoff logged' : 'no pickup logged'})`
        )
      }
      lines.push(`    Week total: ${formatDuration(emp.totalMinutes)} (${formatDecimalHours(emp.totalMinutes)} hrs)`)
    }

    downloadText(`weekly-report-${weekStart}.txt`, lines.join('\n'))
  }

  function prevWeek() {
    setWeekStart(addDays(weekStart, -7))
  }
  function nextWeek() {
    setWeekStart(addDays(weekStart, 7))
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold text-ocean-900">📊 Weekly Report</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={handleExport}>
            ⬇ Export CSV
          </Button>
          <Button variant="ghost" onClick={handleExportText}>
            📄 Export Text
          </Button>
        </div>
      </div>
      <p className="mb-6 text-ocean-700/70">Cancellations, adds, issues, route rosters, and payroll hours for the week.</p>

      <div className="mb-6 flex items-center justify-center gap-4">
        <button onClick={prevWeek} className="text-2xl text-ocean-600">
          ‹
        </button>
        <p className="font-display text-lg font-bold text-ocean-900">
          {formatDate(weekStart)} – {formatDate(weekEnd)}
        </p>
        <button onClick={nextWeek} className="text-2xl text-ocean-600">
          ›
        </button>
      </div>

      <Section title={`❌ Cancellations (${cancellations.length})`}>
        {cancellations.length === 0 && <Empty text="No cancellations this week." />}
        {cancellations.map((e) => (
          <Row key={e.id}>
            <span className="font-semibold text-ocean-900">{formatDate(e.check_in_date)}</span> —{' '}
            <span className="font-semibold">{e.dog.name}</span>: {REASON_LABELS[e.cancel_reason ?? 'other']}
            {e.late_cancel && <span className="ml-1 font-bold text-ocean-800">(LATE CANCEL)</span>}
          </Row>
        ))}
      </Section>

      <Section title={`➕ Adds (${adds.length})`}>
        {adds.length === 0 && <Empty text="No one-off additions this week." />}
        {adds.map((e) => (
          <Row key={e.id}>
            <span className="font-semibold text-ocean-900">{formatDate(e.check_in_date)}</span> —{' '}
            <span className="font-semibold">{e.dog.name}</span> added outside their regular schedule
          </Row>
        ))}
      </Section>

      <Section title={`⚠️ Issues (${entryIssues.length + reportIssues.length})`}>
        {entryIssues.length === 0 && reportIssues.length === 0 && <Empty text="No issues reported this week." />}
        {reportIssues.map((r, i) => (
          <Row key={`r-${i}`}>
            <span className="font-semibold text-ocean-900">{formatDate(r.date)}</span> — {r.source} ({r.type}):{' '}
            {r.note}
          </Row>
        ))}
        {entryIssues.map((e, i) => (
          <Row key={`e-${i}`}>
            <span className="font-semibold text-ocean-900">{formatDate(e.date)}</span> — {e.dog} ({e.type}):{' '}
            {e.note}
          </Row>
        ))}
      </Section>

      <Section title="🗺️ Dogs by Day & Route">
        {weekDates.map((date) => {
          const dayRoutes = routes.filter((r) => r.date === date)
          if (dayRoutes.length === 0) return null
          return (
            <div key={date} className="mb-4">
              <p className="mb-2 font-display font-bold text-ocean-800">{formatDate(date)}</p>
              {dayRoutes.map((route) => {
                const dogs = entries
                  .filter((e) => e.pickup_route_id === route.id)
                  .sort((a, b) => (a.pickup_route_order ?? 0) - (b.pickup_route_order ?? 0))
                  .map((e) => e.dog.name)
                return (
                  <p key={route.id} className="ml-3 text-sm text-ocean-700/80">
                    <span className="font-semibold text-ocean-900">
                      {route.employee?.display_name ?? 'Unassigned'} — Route {route.route_number}:
                    </span>{' '}
                    {dogs.length > 0 ? dogs.join(', ') : 'no dogs'}
                  </p>
                )
              })}
            </div>
          )
        })}
        {routes.length === 0 && <Empty text="No routes set up this week." />}
      </Section>

      <Section title="🐕 Dogs by Dog">
        {dogIds.length === 0 && <Empty text="No hikes scheduled this week." />}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="pb-2 text-left font-semibold text-ocean-700/60">Dog</th>
                {WEEKDAY_SHORT.map((label, i) => (
                  <th key={i} className="pb-2 text-center font-semibold text-ocean-700/60">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dogIds.map((dogId) => (
                <tr key={dogId} className="border-t border-sand-200">
                  <td className="py-2 font-semibold text-ocean-900">{dogNames.get(dogId)}</td>
                  {weekDates.map((date) => {
                    const entry = entries.find((e) => e.dog_id === dogId && e.check_in_date === date)
                    return (
                      <td key={date} className="py-2 text-center">
                        {!entry ? (
                          <span className="text-ocean-700/30">—</span>
                        ) : entry.cancelled ? (
                          <span
                            className="text-xs font-semibold text-ocean-700"
                            title={`Cancelled: ${REASON_LABELS[entry.cancel_reason ?? 'other']}${entry.late_cancel ? ' (late cancel)' : ''}`}
                          >
                            {REASON_LABELS[entry.cancel_reason ?? 'other']}
                          </span>
                        ) : (
                          <span className="font-bold text-ocean-600">✓</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ocean-700/50">
          Example: Rex — ✓ Mon, ✓ Tue, ✓ Wed, Vet Thu (cancelled), ✓ Fri.
        </p>
      </Section>

      <Section title="💵 Payroll">
        <p className="mb-3 text-sm text-ocean-700/70">
          Each day is the time from the employee's first pickup to their last dropoff, rounded up to the next 15 minutes.
          The week is the total of those days.
        </p>
        {payroll.length === 0 && <Empty text="No pickups or dropoffs logged this week." />}
        {payroll.map((emp) => (
          <div key={emp.employeeId} className="mb-5 last:mb-0">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-display font-bold text-ocean-900">{emp.name}</p>
              <p className="font-display font-bold text-ocean-600">
                {formatDecimalHours(emp.totalMinutes)} hrs
                <span className="ml-2 text-sm font-semibold text-ocean-700/60">
                  ({formatDuration(emp.totalMinutes)})
                </span>
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-ocean-700/60">
                    <th className="pb-1 font-semibold">Date</th>
                    <th className="pb-1 font-semibold">First pickup</th>
                    <th className="pb-1 font-semibold">Last dropoff</th>
                    <th className="pb-1 text-right font-semibold">Time</th>
                    <th className="pb-1 text-right font-semibold">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {emp.days.map((d) => (
                    <tr key={d.date} className="border-t border-sand-200 text-ocean-800">
                      <td className="py-1.5 font-semibold text-ocean-900">{formatDate(d.date)}</td>
                      <td className="py-1.5">{formatClockTime(d.firstPickup)}</td>
                      <td className="py-1.5">{formatClockTime(d.lastDropoff)}</td>
                      {d.firstPickup && d.lastDropoff ? (
                        <>
                          <td className="py-1.5 text-right">{formatDuration(d.minutes)}</td>
                          <td className="py-1.5 text-right font-semibold">{formatDecimalHours(d.minutes)}</td>
                        </>
                      ) : (
                        <td colSpan={2} className="py-1.5 text-right text-xs font-semibold text-sun-700">
                          {d.firstPickup ? 'No dropoff logged' : 'No pickup logged'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="mb-6">
      <h2 className="mb-3 font-display text-lg font-bold text-ocean-800">{title}</h2>
      {children}
    </Card>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-sm text-ocean-800">{children}</p>
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-ocean-700/50">{text}</p>
}
