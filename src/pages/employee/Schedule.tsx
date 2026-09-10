import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/contexts/AuthContext'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'
import type { Client, Dog, Route, ScheduleEntry } from '@/types/database'

type EntryWithDog = ScheduleEntry & { dog: Dog & { client: Client } }

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('default', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function EmployeeSchedule() {
  const { employee } = useAuth()
  const [routes, setRoutes] = useState<Route[] | null>(null)
  const [entries, setEntries] = useState<EntryWithDog[]>([])

  useEffect(() => {
    if (!employee) return

    async function load() {
      const { data: routeData } = await supabase
        .from('routes')
        .select('*')
        .eq('employee_id', employee!.id)
        .gt('date', todayStr())
        .lte('date', addDays(todayStr(), 7))
        .order('date')
        .order('route_number')

      const routeRows = routeData ?? []
      setRoutes(routeRows)

      if (routeRows.length === 0) {
        setEntries([])
        return
      }

      const idList = routeRows.map((r) => r.id).join(',')
      const { data: entryData } = await supabase
        .from('schedule_entries')
        .select('*, dog:dogs(*, client:clients(*))')
        .or(`pickup_route_id.in.(${idList}),dropoff_route_id.in.(${idList})`)
      setEntries((entryData as EntryWithDog[] | null) ?? [])
    }
    load()
  }, [employee])

  if (!routes) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-extrabold text-ocean-900">📅 My Schedule</h1>
      <p className="mb-6 text-ocean-700/70">Your routes for the next 7 days.</p>

      {routes.length === 0 && (
        <Card>
          <p className="text-ocean-700/70">No routes assigned in the next 7 days yet — check back later.</p>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {routes.map((route) => {
          const pickups = entries
            .filter((e) => e.pickup_route_id === route.id)
            .sort((a, b) => (a.pickup_route_order ?? 0) - (b.pickup_route_order ?? 0))
          const dropoffs = entries
            .filter((e) => e.dropoff_route_id === route.id)
            .sort((a, b) => (a.dropoff_route_order ?? 0) - (b.dropoff_route_order ?? 0))

          return (
            <Card key={route.id}>
              <p className="mb-3 font-display font-bold text-ocean-900">
                {formatDate(route.date)} — Route {route.route_number}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DogListSection title="🚗 Pick Up" entries={pickups} />
                <DogListSection title="🏠 Drop Off" entries={dropoffs} />
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function DogListSection({ title, entries }: { title: string; entries: EntryWithDog[] }) {
  if (entries.length === 0) return null
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase text-ocean-700/50">{title}</p>
      {entries.map((e) => (
        <p key={e.id} className="text-sm text-ocean-800">
          <span className="font-semibold">{e.dog.name}</span> — {e.dog.client.main_name}
          {e.cancelled && (
            <span className="ml-2 text-xs font-semibold text-ocean-700">
              (Cancelled{e.cancel_reason ? `: ${capitalize(e.cancel_reason)}` : ''})
            </span>
          )}
          {e.late_pickup_by_owner && (
            <span className="ml-2 text-xs font-semibold text-sun-700">(Owner picking up late)</span>
          )}
        </p>
      ))}
    </div>
  )
}
