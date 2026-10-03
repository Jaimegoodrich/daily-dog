import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { Client, Dog, Route, ScheduleEntry } from '@/types/database'

export type EntryWithDog = ScheduleEntry & { dog: Dog & { client: Client } }
export type EmployeeOption = { id: string; display_name: string }

export function dayOfWeek(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').getDay()
}

/**
 * Loads a day's routes, schedule entries, and active employees, and exposes
 * the mutations for assigning dogs to routes.
 *
 * Every assign, move, remove and reorder also saves the affected route's
 * list as the default for this weekday, so next week starts out the same
 * way until admin changes it (one-off adds stay one-offs).
 */
export function useRoutesForDay(date: string) {
  const [routes, setRoutes] = useState<Route[]>([])
  const [entries, setEntries] = useState<EntryWithDog[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true)
    // Safety net: backfill this month's recurring hike days even if nobody
    // has opened the Weekly Schedule page for it yet.
    const [year, month] = date.split('-').map(Number)
    await supabase.rpc('ensure_schedule_for_month', { p_year: year, p_month: month })
    // Auto-slot dogs onto their default route for this weekday, if one is set
    // and a route with that number already exists for this date.
    await supabase.rpc('apply_default_routes_for_date', { p_date: date })

    const [{ data: routeData }, { data: entryData }, { data: employeeData }] = await Promise.all([
      supabase.from('routes').select('*').eq('date', date).order('route_number'),
      // Includes cancelled entries — callers that only care about active
      // routing (like the Routes page) should filter those out themselves;
      // callers that need to display cancellations (like the Calendar page)
      // can use the full set.
      supabase
        .from('schedule_entries')
        .select('*, dog:dogs(*, client:clients(*))')
        .or(`scheduled_pickup_date.eq.${date},scheduled_dropoff_date.eq.${date}`),
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
    load(false)
  }

  async function saveDefault(routeId: string, field: 'pickup' | 'dropoff') {
    await supabase.rpc('save_route_as_default', { p_route_id: routeId, p_field: field })
  }

  async function assign(entryId: string, routeId: string, field: 'pickup' | 'dropoff') {
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) return
    const routeKey = field === 'pickup' ? 'pickup_route_id' : 'dropoff_route_id'
    const orderKey = field === 'pickup' ? 'pickup_route_order' : 'dropoff_route_order'
    const previousRouteId = entry[routeKey]
    const routeEntries = entries.filter((e) => e[routeKey] === routeId)
    await supabase
      .from('schedule_entries')
      .update({ [routeKey]: routeId || null, [orderKey]: routeEntries.length })
      .eq('id', entryId)

    if (routeId) {
      await saveDefault(routeId, field)
    } else {
      await supabase.rpc('clear_default_route', {
        p_dog_id: entry.dog_id,
        p_day_of_week: dayOfWeek(date),
        p_field: field,
      })
    }
    // Close the gap left on the route the dog came off.
    if (previousRouteId && previousRouteId !== routeId) await saveDefault(previousRouteId, field)
    load(false)
  }

  // A one-day change of place for that leg; doesn't carry to future weeks.
  async function setAtJaimes(entryId: string, field: 'pickup' | 'dropoff', atJaimes: boolean) {
    await supabase
      .from('schedule_entries')
      .update({ [field === 'pickup' ? 'pickup_at_jaimes' : 'dropoff_at_jaimes']: atJaimes })
      .eq('id', entryId)
    load(false)
  }

  const assignPickup = (entryId: string, routeId: string) => assign(entryId, routeId, 'pickup')
  const assignDropoff = (entryId: string, routeId: string) => assign(entryId, routeId, 'dropoff')

  async function reorder(
    list: EntryWithDog[],
    field: 'pickup_route_order' | 'dropoff_route_order',
    fromIndex: number,
    toIndex: number
  ) {
    if (fromIndex === toIndex) return
    const reordered = [...list]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    await Promise.all(
      reordered.map((entry, i) => supabase.from('schedule_entries').update({ [field]: i }).eq('id', entry.id))
    )
    const routeId = field === 'pickup_route_order' ? moved.pickup_route_id : moved.dropoff_route_id
    if (routeId) await saveDefault(routeId, field === 'pickup_route_order' ? 'pickup' : 'dropoff')
    load(false)
  }

  return {
    routes,
    entries,
    employees,
    loading,
    load,
    setRouteEmployee,
    setAtJaimes,
    assignPickup,
    assignDropoff,
    reorder,
  }
}
