import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Select, Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import type { Client, Dog, Route, ScheduleEntry } from '@/types/database'

type EntryWithDog = ScheduleEntry & { dog: Dog & { client: Client } }
type EmployeeOption = { id: string; display_name: string }

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export function AdminRoutes() {
  const [date, setDate] = useState(todayStr())
  const [routes, setRoutes] = useState<Route[]>([])
  const [entries, setEntries] = useState<EntryWithDog[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    // Safety net: backfill this month's recurring hike days even if nobody
    // has opened the Weekly Schedule page for it yet.
    const [year, month] = date.split('-').map(Number)
    await supabase.rpc('ensure_schedule_for_month', { p_year: year, p_month: month })

    const [{ data: routeData }, { data: entryData }, { data: employeeData }] = await Promise.all([
      supabase.from('routes').select('*').eq('date', date).order('route_number'),
      supabase
        .from('schedule_entries')
        .select('*, dog:dogs(*, client:clients(*))')
        .or(`scheduled_pickup_date.eq.${date},scheduled_dropoff_date.eq.${date}`)
        .eq('cancelled', false),
      supabase.rpc('list_active_employees'),
    ])
    setRoutes(routeData ?? [])
    setEntries((entryData as EntryWithDog[] | null) ?? [])
    setEmployees(employeeData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  async function setRouteEmployee(routeNumber: number, employeeId: string) {
    const existing = routes.find((r) => r.route_number === routeNumber)
    if (existing) {
      await supabase.from('routes').update({ employee_id: employeeId || null }).eq('id', existing.id)
    } else if (employeeId) {
      await supabase.from('routes').insert({ date, route_number: routeNumber, employee_id: employeeId })
    }
    load()
  }

  async function assignPickup(entryId: string, routeId: string) {
    const routeEntries = entries.filter((e) => e.pickup_route_id === routeId)
    await supabase
      .from('schedule_entries')
      .update({ pickup_route_id: routeId || null, pickup_route_order: routeEntries.length })
      .eq('id', entryId)
    load()
  }

  async function assignDropoff(entryId: string, routeId: string) {
    const routeEntries = entries.filter((e) => e.dropoff_route_id === routeId)
    await supabase
      .from('schedule_entries')
      .update({ dropoff_route_id: routeId || null, dropoff_route_order: routeEntries.length })
      .eq('id', entryId)
    load()
  }

  async function reorder(list: EntryWithDog[], field: 'pickup_route_order' | 'dropoff_route_order', index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= list.length) return
    const a = list[index]
    const b = list[target]
    await Promise.all([
      supabase.from('schedule_entries').update({ [field]: target }).eq('id', a.id),
      supabase.from('schedule_entries').update({ [field]: index }).eq('id', b.id),
    ])
    load()
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  const unassignedPickups = entries.filter((e) => e.scheduled_pickup_date === date && !e.pickup_route_id)
  const unassignedDropoffs = entries.filter(
    (e) => e.scheduled_dropoff_date === date && !e.dropoff_route_id && !e.late_pickup_by_owner
  )

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-extrabold text-ocean-900">🗺️ Routes</h1>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((num) => {
          const route = routes.find((r) => r.route_number === num)
          return (
            <Card key={num}>
              <p className="mb-2 font-display font-bold text-ocean-900">Route {num}</p>
              <Select
                value={route?.employee_id ?? ''}
                onChange={(e) => setRouteEmployee(num, e.target.value)}
              >
                <option value="">Unassigned</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.display_name}
                  </option>
                ))}
              </Select>
              {route && <p className="mt-2 text-xs font-semibold text-ocean-700/60">{route.status}</p>}
            </Card>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-3 font-display text-lg font-bold text-ocean-800">Unassigned Pickups</h2>
          <div className="flex flex-col gap-2">
            {unassignedPickups.map((entry) => (
              <UnassignedRow key={entry.id} entry={entry} routes={routes} onAssign={(rid) => assignPickup(entry.id, rid)} />
            ))}
            {unassignedPickups.length === 0 && <p className="text-sm text-ocean-700/50">All assigned.</p>}
          </div>
        </div>
        <div>
          <h2 className="mb-3 font-display text-lg font-bold text-ocean-800">Unassigned Dropoffs</h2>
          <div className="flex flex-col gap-2">
            {unassignedDropoffs.map((entry) => (
              <UnassignedRow key={entry.id} entry={entry} routes={routes} onAssign={(rid) => assignDropoff(entry.id, rid)} />
            ))}
            {unassignedDropoffs.length === 0 && <p className="text-sm text-ocean-700/50">All assigned.</p>}
          </div>
        </div>
      </div>

      {routes.map((route) => {
        const pickupList = entries
          .filter((e) => e.pickup_route_id === route.id)
          .sort((a, b) => (a.pickup_route_order ?? 0) - (b.pickup_route_order ?? 0))
        const dropoffList = entries
          .filter((e) => e.dropoff_route_id === route.id)
          .sort((a, b) => (a.dropoff_route_order ?? 0) - (b.dropoff_route_order ?? 0))

        return (
          <div key={route.id} className="mt-8">
            <h2 className="mb-3 font-display text-xl font-bold text-ocean-900">Route {route.route_number} Order</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <OrderedList
                title="Pickups"
                list={pickupList}
                onUp={(i) => reorder(pickupList, 'pickup_route_order', i, -1)}
                onDown={(i) => reorder(pickupList, 'pickup_route_order', i, 1)}
                onRemove={(id) => assignPickup(id, '')}
              />
              <OrderedList
                title="Dropoffs"
                list={dropoffList}
                onUp={(i) => reorder(dropoffList, 'dropoff_route_order', i, -1)}
                onDown={(i) => reorder(dropoffList, 'dropoff_route_order', i, 1)}
                onRemove={(id) => assignDropoff(id, '')}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function UnassignedRow({
  entry,
  routes,
  onAssign,
}: {
  entry: EntryWithDog
  routes: Route[]
  onAssign: (routeId: string) => void
}) {
  return (
    <Card className="flex items-center justify-between">
      <div>
        <p className="font-semibold text-ocean-900">{entry.dog.name}</p>
        <p className="text-xs text-ocean-700/60">{entry.dog.client.main_name}</p>
      </div>
      <Select defaultValue="" onChange={(e) => e.target.value && onAssign(e.target.value)} className="w-40">
        <option value="">Assign to...</option>
        {routes.map((r) => (
          <option key={r.id} value={r.id}>
            Route {r.route_number}
          </option>
        ))}
      </Select>
    </Card>
  )
}

function OrderedList({
  title,
  list,
  onUp,
  onDown,
  onRemove,
}: {
  title: string
  list: EntryWithDog[]
  onUp: (i: number) => void
  onDown: (i: number) => void
  onRemove: (id: string) => void
}) {
  return (
    <div>
      <p className="mb-2 font-semibold text-ocean-800">{title}</p>
      <div className="flex flex-col gap-2">
        {list.map((entry, i) => (
          <Card key={entry.id} className="flex items-center justify-between py-2">
            <p className="font-semibold text-ocean-900">
              {i + 1}. {entry.dog.name}
            </p>
            <div className="flex gap-2 text-sm">
              <button onClick={() => onUp(i)} disabled={i === 0} className="disabled:opacity-30">
                ↑
              </button>
              <button onClick={() => onDown(i)} disabled={i === list.length - 1} className="disabled:opacity-30">
                ↓
              </button>
              <button onClick={() => onRemove(entry.id)} className="text-ocean-700">
                ✕
              </button>
            </div>
          </Card>
        ))}
        {list.length === 0 && <p className="text-sm text-ocean-700/50">None assigned.</p>}
      </div>
    </div>
  )
}
