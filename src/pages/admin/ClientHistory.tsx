import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { downloadCSV } from '@/lib/csv'
import {
  buildClientHistory,
  formatHistoryDate,
  historySummary,
  type ClientHistory as History,
  type HistoryHike,
  type HistoryStay,
} from '@/lib/clientHistory'
import type { Client } from '@/types/database'

const PAGE = 1000

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const HIKE_SELECT =
  '*, dog:dogs(id, name), ' +
  'pickup_route:routes!pickup_route_id(route_number, employee:employees(display_name)), ' +
  'dropoff_route:routes!dropoff_route_id(route_number, employee:employees(display_name))'

// Supabase caps a select at 1000 rows, so a long range is fetched in pages.
async function fetchHikes(dogIds: string[], start: string, end: string) {
  const all: HistoryHike[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('schedule_entries')
      .select(HIKE_SELECT)
      .eq('type', 'hike')
      .in('dog_id', dogIds)
      .gte('check_in_date', start)
      .lte('check_in_date', end)
      .order('check_in_date')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data as unknown as HistoryHike[] | null) ?? []
    all.push(...rows)
    if (rows.length < PAGE) return all
  }
}

export function ClientHistory() {
  const today = new Date()
  const [clients, setClients] = useState<Client[]>([])
  const [clientId, setClientId] = useState('')
  const [start, setStart] = useState(toDateStr(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [end, setEnd] = useState(toDateStr(today))
  const [history, setHistory] = useState<History | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportingPdf, setExportingPdf] = useState(false)

  useEffect(() => {
    supabase
      .from('clients')
      .select('*')
      .order('main_name')
      .then(({ data }) => setClients((data as Client[] | null) ?? []))
  }, [])

  const rangeValid = !!start && !!end && start <= end

  useEffect(() => {
    if (!clientId || !rangeValid) return
    let stale = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data: dogData, error: dogError } = await supabase.from('dogs').select('id').eq('client_id', clientId)
        if (dogError) throw dogError
        const dogIds = (dogData ?? []).map((d) => d.id as string)
        if (dogIds.length === 0) {
          if (!stale) setHistory(buildClientHistory(start, end, [], []))
          return
        }
        const [hikes, { data: stayData, error: stayError }] = await Promise.all([
          fetchHikes(dogIds, start, end),
          supabase
            .from('schedule_entries')
            .select('*, dog:dogs(id, name), transports:after_hours_transports(*, employee:employees(display_name))')
            .eq('type', 'boarding')
            .in('dog_id', dogIds)
            .lte('check_in_date', end)
            .gte('check_out_date', start),
        ])
        if (stayError) throw stayError
        if (!stale) setHistory(buildClientHistory(start, end, hikes, (stayData as unknown as HistoryStay[] | null) ?? []))
      } catch (e) {
        if (!stale) {
          setHistory(null)
          setError(e instanceof Error ? e.message : 'Could not load the history.')
        }
      } finally {
        if (!stale) setLoading(false)
      }
    }
    load()
    return () => {
      stale = true
    }
  }, [clientId, start, end, rangeValid])

  const client = clients.find((c) => c.id === clientId)
  const rangeLabel = rangeValid ? `${formatHistoryDate(start)} – ${formatHistoryDate(end)}` : ''
  const fileBase = client ? `client-history-${slug(client.main_name)}-${start}-to-${end}` : ''

  function handleExportCSV() {
    if (!history || !client) return
    const rows: unknown[][] = [['Client', 'Date', 'Dog', 'Service', 'Pickup', 'Dropoff', 'Route / Staff', 'Notes']]
    for (const r of history.rows) {
      rows.push([client.main_name, r.date, r.dogName, r.service, r.pickup, r.dropoff, r.by, r.notes])
    }
    downloadCSV(`${fileBase}.csv`, rows)
  }

  async function handleExportPDF() {
    if (!history || !client) return
    setExportingPdf(true)
    try {
      // Loaded on demand so the PDF library isn't part of every page load.
      const { buildClientHistoryPdf } = await import('@/lib/clientHistoryPdf')
      buildClientHistoryPdf(client.main_name, rangeLabel, history).save(`${fileBase}.pdf`)
    } finally {
      setExportingPdf(false)
    }
  }

  const canExport = !!history && history.rows.length > 0 && !loading && rangeValid

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold text-ocean-900">🧾 Client History</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={handleExportPDF} disabled={!canExport || exportingPdf}>
            {exportingPdf ? 'Making PDF…' : '📑 Export PDF'}
          </Button>
          <Button variant="ghost" onClick={handleExportCSV} disabled={!canExport}>
            ⬇ Export CSV
          </Button>
        </div>
      </div>
      <p className="mb-4 text-ocean-700/70">
        Every hike, boarding night, after-hours transport, and cancellation for one client, with the pickup and dropoff
        times logged on each date. Useful when a client questions a charge.
      </p>

      <Card className="mb-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Client" id="history-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Choose a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.main_name}
              </option>
            ))}
          </Select>
          <Input label="From" id="history-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <Input label="To" id="history-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        {!rangeValid && start && end && <p className="mt-2 text-sm text-red-600">The start date is after the end date.</p>}
      </Card>

      {!clientId && <p className="text-center text-ocean-700/50">Choose a client to see their history.</p>}

      {error && <p className="text-center text-red-600">{error}</p>}

      {loading && (
        <div className="flex justify-center py-10">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      {!loading && rangeValid && history && client && (
        <Card>
          <div className="mb-3">
            <p className="font-display text-lg font-bold text-ocean-900">{client.main_name}</p>
            <p className="text-sm text-ocean-700/70">{rangeLabel}</p>
            <p className="mt-1 text-sm font-semibold text-ocean-800">{historySummary(history)}</p>
          </div>
          {history.rows.length === 0 ? (
            <p className="text-ocean-700/50">No hikes or boarding in this date range.</p>
          ) : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-sand-300 text-xs uppercase text-ocean-700/60">
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Dog</th>
                    <th className="px-2 py-2">Service</th>
                    <th className="px-2 py-2">🚗 Pickup</th>
                    <th className="px-2 py-2">🏠 Dropoff</th>
                    <th className="px-2 py-2">Route / Staff</th>
                    <th className="px-2 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {history.rows.map((r, i) => {
                    const newDate = i === 0 || history.rows[i - 1].date !== r.date
                    return (
                      <tr
                        key={i}
                        className={`${newDate && i > 0 ? 'border-t border-sand-200' : ''} align-top ${
                          r.cancelled ? 'text-ocean-700/50' : 'text-ocean-800'
                        }`}
                      >
                        <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-ocean-900">
                          {newDate ? formatHistoryDate(r.date) : ''}
                        </td>
                        <td className="px-2 py-1.5">{r.dogName}</td>
                        <td className={`px-2 py-1.5 ${r.cancelled ? 'line-through' : ''}`}>{r.service}</td>
                        <td className={`px-2 py-1.5 ${r.pickup.startsWith('Not logged') ? 'text-amber-700' : ''}`}>
                          {r.pickup}
                        </td>
                        <td className={`px-2 py-1.5 ${r.dropoff.startsWith('Not logged') ? 'text-amber-700' : ''}`}>
                          {r.dropoff}
                        </td>
                        <td className="px-2 py-1.5">{r.by}</td>
                        <td className="px-2 py-1.5">{r.notes}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
