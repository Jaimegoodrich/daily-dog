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
 * the mutations for assigning dogs to routes for that day only.
 *
 * Assigning/reassigning a route (assignPickup/assignDropoff) never touches a
 * dog's recurring default route — that's a separate, explicit action via
 * setDefaultRoute, so admins can move a dog to cover for someone just for the
 * day without changing what auto-fills on future weeks.
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

  async function setDefaultRoute(entryId: string, routeId: string) {
    const route = routes.find((r) => r.id === routeId)
    const entry = entries.find((e) => e.id === entryId)
    if (!route || !entry) return
    await supabase.rpc('set_default_route', {
      p_dog_id: entry.dog_id,
      p_day_of_week: dayOfWeek(date),
      p_route_number: route.route_number,
    })
  }

  async function assignPickup(entryId: string, routeId: string) {
    const routeEntries = entries.filter((e) => e.pickup_route_id === routeId)
    await supabase
      .from('schedule_entries')
      .update({ pickup_route_id: routeId || null, pickup_route_order: routeEntries.length })
      .eq('id', entryId)
    load(false)
  }

  async function assignDropoff(entryId: string, routeId: string) {
    const routeEntries = entries.filter((e) => e.dropoff_route_id === routeId)
    await supabase
      .from('schedule_entries')
      .update({ dropoff_route_id: routeId || null, dropoff_route_order: routeEntries.length })
      .eq('id', entryId)
    load(false)
  }

  async function reorder(
    list: EntryWithDog[],
    field: 'pickup_route_order' | 'dropoff_route_order',
    fromIndex: number,
    toIndex: number
  ) {
    if (fromIndex === toIndex) return list.map((e) => e.dog_id)
    const reordered = [...list]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    await Promise.all(
      reordered.map((entry, i) => supabase.from('schedule_entries').update({ [field]: i }).eq('id', entry.id))
    )
    load(false)
    return reordered.map((e) => e.dog_id)
  }

  // Persists the current order of a route's pickup or dropoff list as the
  // default for every future occurrence of this weekday, alongside the route
  // itself — a separate, explicit action from reorder() so a one-off
  // rearrangement doesn't silently change what auto-fills next week.
  async function setDefaultOrder(field: 'pickup' | 'dropoff', routeNumber: number, dogIdsInOrder: string[]) {
    const fn = field === 'pickup' ? 'set_default_pickup_order' : 'set_default_dropoff_order'
    await supabase.rpc(fn, {
      p_dog_ids: dogIdsInOrder,
      p_day_of_week: dayOfWeek(date),
      p_route_number: routeNumber,
    })
  }

  return {
    routes,
    entries,
    employees,
    loading,
    load,
    setRouteEmployee,
    setDefaultRoute,
    setDefaultOrder,
    assignPickup,
    assignDropoff,
    reorder,
  }
}
