import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { downloadCSV, downloadText } from '@/lib/csv'
import {
  buildMonthlyReport,
  dogReportLines,
  formatDay,
  formatDayList,
  formatTimeOfDay,
  monthBounds,
  type ClientMonthReport,
  type DogWithClient,
  type StayWithTransports,
} from '@/lib/monthlyReport'
import type { ScheduleEntry } from '@/types/database'

const PAGE = 1000

// Supabase caps a select at 1000 rows, so a busy month is fetched in pages.
async function fetchAllHikes(start: string, end: string) {
  const all: ScheduleEntry[] = []
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from('schedule_entries')
      .select('*')
      .eq('type', 'hike')
      .gte('check_in_date', start)
      .lte('check_in_date', end)
      .order('check_in_date')
      .order('id')
      .range(from, from + PAGE - 1)
    const rows = (data as ScheduleEntry[] | null) ?? []
    all.push(...rows)
    if (rows.length < PAGE) return all
  }
}

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function MonthlyReport() {
  const [month, setMonth] = useState(currentMonth())
  const [clients, setClients] = useState<ClientMonthReport[] | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [exportingPdf, setExportingPdf] = useState(false)

  useEffect(() => {
    let stale = false
    async function load() {
      setClients(null)
      const { start, end } = monthBounds(month)
      const [hikes, { data: stayData }, { data: dogData }, { data: patternData }] = await Promise.all([
        fetchAllHikes(start, end),
        supabase
          .from('schedule_entries')
          .select('*, transports:after_hours_transports(*)')
          .eq('type', 'boarding')
          .lte('check_in_date', end)
          .gte('check_out_date', start),
        supabase.from('dogs').select('*, client:clients(*)'),
        supabase.from('dog_weekly_pattern').select('dog_id, day_of_week'),
      ])
      const patternByDog = new Map<string, Set<number>>()
      for (const p of patternData ?? []) {
        if (!patternByDog.has(p.dog_id)) patternByDog.set(p.dog_id, new Set())
        patternByDog.get(p.dog_id)!.add(p.day_of_week)
      }
      if (stale) return
      setClients(
        buildMonthlyReport(
          month,
          (dogData as DogWithClient[] | null) ?? [],
          hikes,
          (stayData as StayWithTransports[] | null) ?? [],
          patternByDog
        )
      )
    }
    load()
    return () => {
      stale = true
    }
  }, [month])

  function clientText(c: ClientMonthReport) {
    return [`${c.clientName} — ${monthLabel(month)}`, ...c.dogs.flatMap((d) => ['', ...dogReportLines(d)])].join('\n')
  }

  async function copyClient(c: ClientMonthReport) {
    try {
      await navigator.clipboard.writeText(clientText(c))
      setCopiedId(c.clientId)
      setTimeout(() => setCopiedId((id) => (id === c.clientId ? null : id)), 2000)
    } catch {
      // Clipboard can be blocked; the text export still works.
    }
  }

  function handleExportText() {
    const parts = [`Daily Dog — Monthly Client Report`, monthLabel(month), '']
    for (const c of clients ?? []) parts.push(clientText(c), '', '----------', '')
    downloadText(`monthly-report-${month}.txt`, parts.join('\n'))
  }

  async function handleExportPDF() {
    setExportingPdf(true)
    try {
      // Loaded on demand so the PDF library isn't part of every page load.
      const { buildMonthlyReportPdf } = await import('@/lib/monthlyReportPdf')
      buildMonthlyReportPdf(clients ?? [], monthLabel(month)).save(`monthly-report-${month}.pdf`)
    } finally {
      setExportingPdf(false)
    }
  }

  function handleExportCSV() {
    const rows: unknown[][] = [
      [
        'Client',
        'Dog',
        'Hike Count',
        'Hike Dates',
        'Added Outside Schedule',
        'Cancellations',
        'Overnights',
        'Boarding Stays',
        'After-Hours Pickups/Dropoffs',
      ],
    ]
    for (const c of clients ?? []) {
      for (const d of c.dogs) {
        rows.push([
          c.clientName,
          d.dog.name,
          d.hikes.length,
          formatDayList(d.hikes),
          formatDayList(d.adds),
          d.cancellations
            .map((x) => `${formatDay(x.date)} (${x.reason}${x.late ? ', late' : ''})`)
            .join('; '),
          d.stays.reduce((n, s) => n + s.nights.length, 0),
          d.stays
            .map((s) => `${formatDay(s.checkIn)} – ${formatDay(s.checkOut)}: nights of ${formatDayList(s.nights)}`)
            .join('; '),
          d.stays
            .flatMap((s) => s.afterHours.map((t) => `${t.kind} ${formatDay(t.date)} ${formatTimeOfDay(t.time)}`))
            .join('; '),
        ])
      }
    }
    downloadCSV(`monthly-report-${month}.csv`, rows)
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold text-ocean-900">🗓️ Monthly Report</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-48" />
          <Button variant="ghost" onClick={handleExportPDF} disabled={!clients || clients.length === 0 || exportingPdf}>
            {exportingPdf ? 'Making PDF…' : '📑 Export PDF'}
          </Button>
          <Button variant="ghost" onClick={handleExportCSV} disabled={!clients || clients.length === 0}>
            ⬇ Export CSV
          </Button>
          <Button variant="ghost" onClick={handleExportText} disabled={!clients || clients.length === 0}>
            📄 Export Text
          </Button>
        </div>
      </div>
      <p className="mb-6 text-ocean-700/70">
        For each client and dog: hikes, adds outside the regular schedule, cancellations, boarding overnights, and
        after-hours pickups and dropoffs for {monthLabel(month)}.
      </p>

      {clients === null && (
        <div className="flex justify-center py-10">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      {clients?.length === 0 && (
        <p className="text-center text-ocean-700/50">No hikes or boarding in {monthLabel(month)}.</p>
      )}

      <div className="flex flex-col gap-4">
        {clients?.map((c) => (
          <Card key={c.clientId}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="font-display text-lg font-bold text-ocean-900">{c.clientName}</p>
              <Button variant="ghost" className="px-3 py-1.5 text-sm" onClick={() => copyClient(c)}>
                {copiedId === c.clientId ? '✓ Copied' : '📋 Copy'}
              </Button>
            </div>
            <div className="flex flex-col gap-3">
              {c.dogs.map((d) => {
                const [first, ...rest] = dogReportLines(d)
                return (
                  <div key={d.dog.id} className="rounded-2xl bg-sand-50 p-3 text-sm text-ocean-800">
                    <p className="font-semibold text-ocean-900">{first}</p>
                    {rest.map((line, i) => (
                      <p key={i} className={line.startsWith('  ') ? 'pl-4' : ''}>
                        {line.trim()}
                      </p>
                    ))}
                  </div>
                )
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
