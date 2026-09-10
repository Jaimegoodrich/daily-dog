import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { downloadCSV } from '@/lib/csv'
import type { DailyReport, Dog, Employee, Route, ScheduleEntry } from '@/types/database'

type ReportRow = DailyReport & { employee: Employee | null; route: Route | null }
type EntryWithDog = ScheduleEntry & { dog: Dog }

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function formatTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('default', { hour: 'numeric', minute: '2-digit' })
}

export function AdminReports() {
  const [date, setDate] = useState(todayStr())
  const [reports, setReports] = useState<ReportRow[] | null>(null)
  const [entriesByRoute, setEntriesByRoute] = useState<Map<string, EntryWithDog[]>>(new Map())

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('daily_reports')
        .select('*, employee:employees(*), route:routes(*)')
        .eq('date', date)
        .order('submitted_at', { ascending: false })
      const reportRows = (data as ReportRow[] | null) ?? []
      setReports(reportRows)

      const routeIds = reportRows.map((r) => r.route_id)
      if (routeIds.length === 0) {
        setEntriesByRoute(new Map())
        return
      }
      const idList = routeIds.join(',')
      const { data: entryData } = await supabase
        .from('schedule_entries')
        .select('*, dog:dogs(*)')
        .or(`pickup_route_id.in.(${idList}),dropoff_route_id.in.(${idList})`)

      const map = new Map<string, EntryWithDog[]>()
      for (const routeId of routeIds) {
        map.set(routeId, ((entryData as EntryWithDog[] | null) ?? []).filter(
          (e) => e.pickup_route_id === routeId || e.dropoff_route_id === routeId
        ))
      }
      setEntriesByRoute(map)
    }
    load()
  }, [date])

  function handleExport() {
    const rows: unknown[][] = [
      [
        'Date',
        'Employee',
        'Route',
        'Dog',
        'Picked Up',
        'Dropped Off',
        'Arrived at Farm',
        'Left Farm',
        'Van Issues',
        'Farm Issues',
        'Client Issues',
        'Submitted At',
      ],
    ]
    for (const r of reports ?? []) {
      const entries = entriesByRoute.get(r.route_id) ?? []
      const dogRows = entries.length > 0 ? entries : [null]
      for (const e of dogRows) {
        rows.push([
          date,
          r.employee?.display_name ?? '',
          r.route?.route_number ?? '',
          e?.dog.name ?? '',
          e && e.pickup_route_id === r.route_id ? formatTime(e.actual_pickup_at) : '',
          e && e.dropoff_route_id === r.route_id ? formatTime(e.actual_dropoff_at) : '',
          formatTime(r.route?.arrived_at_farm_at ?? null),
          formatTime(r.route?.left_farm_at ?? null),
          r.van_issues ?? '',
          r.farm_issues ?? '',
          r.client_issues ?? '',
          new Date(r.submitted_at).toLocaleString(),
        ])
      }
    }
    downloadCSV(`daily-report-${date}.csv`, rows)
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-extrabold text-ocean-900">📋 Daily Reports</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" />
          <Button variant="ghost" onClick={handleExport} disabled={!reports || reports.length === 0}>
            ⬇ Export CSV
          </Button>
        </div>
      </div>

      {reports === null && (
        <div className="flex justify-center py-10">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      <div className="flex flex-col gap-4">
        {reports?.map((report) => {
          const entries = entriesByRoute.get(report.route_id) ?? []
          const pickups = entries
            .filter((e) => e.pickup_route_id === report.route_id)
            .sort((a, b) => (a.pickup_route_order ?? 0) - (b.pickup_route_order ?? 0))
          const dropoffs = entries
            .filter((e) => e.dropoff_route_id === report.route_id)
            .sort((a, b) => (a.dropoff_route_order ?? 0) - (b.dropoff_route_order ?? 0))

          return (
            <Card key={report.id}>
              <div className="mb-3 flex items-center justify-between">
                <p className="font-display font-bold text-ocean-900">
                  {report.employee?.display_name} — Route {report.route?.route_number}
                </p>
                <p className="text-xs text-ocean-700/60">
                  {new Date(report.submitted_at).toLocaleTimeString()}
                </p>
              </div>

              {(pickups.length > 0 || dropoffs.length > 0) && (
                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TimeList title="🚗 Pickups" entries={pickups} getTime={(e) => e.actual_pickup_at} />
                  <TimeList title="🏠 Dropoffs" entries={dropoffs} getTime={(e) => e.actual_dropoff_at} />
                </div>
              )}

              {(report.route?.arrived_at_farm_at || report.route?.left_farm_at) && (
                <p className="mb-3 text-sm text-ocean-800">
                  <span className="text-xs font-semibold uppercase text-ocean-700/50">🏞️ Farm — </span>
                  Arrived {formatTime(report.route?.arrived_at_farm_at ?? null)}, Left{' '}
                  {formatTime(report.route?.left_farm_at ?? null)}
                </p>
              )}

              <IssueBlock label="Van" text={report.van_issues} />
              <IssueBlock label="Farm" text={report.farm_issues} />
              <IssueBlock label="Client" text={report.client_issues} />
              {!report.van_issues && !report.farm_issues && !report.client_issues && (
                <p className="text-sm text-green-600">No issues reported. 🎉</p>
              )}
            </Card>
          )
        })}
        {reports?.length === 0 && (
          <p className="text-center text-ocean-700/50">No reports submitted for this date yet.</p>
        )}
      </div>
    </div>
  )
}

function TimeList({
  title,
  entries,
  getTime,
}: {
  title: string
  entries: EntryWithDog[]
  getTime: (e: EntryWithDog) => string | null
}) {
  if (entries.length === 0) return null
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase text-ocean-700/50">{title}</p>
      {entries.map((e) => (
        <p key={e.id} className="text-sm text-ocean-800">
          <span className="font-semibold">{e.dog.name}</span> — {formatTime(getTime(e))}
        </p>
      ))}
    </div>
  )
}

function IssueBlock({ label, text }: { label: string; text: string | null }) {
  if (!text) return null
  return (
    <div className="mb-2">
      <p className="text-sm font-semibold text-ocean-700">{label}:</p>
      <p className="text-sm text-ocean-800">{text}</p>
    </div>
  )
}
