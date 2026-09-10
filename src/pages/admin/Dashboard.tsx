import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'
import type { Employee, Route } from '@/types/database'

type RouteWithEmployee = Route & { employee: Employee | null }
type UpcomingBirthday = { id: string; name: string; days: number; nextDate: Date; turningAge: number }

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function getUpcomingBirthdays(dogs: { id: string; name: string; birthday: string | null }[]): UpcomingBirthday[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const upcoming: UpcomingBirthday[] = []
  for (const dog of dogs) {
    if (!dog.birthday) continue
    const birth = new Date(dog.birthday + 'T00:00:00')
    const next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate())
    if (next < today) next.setFullYear(today.getFullYear() + 1)
    const days = Math.round((next.getTime() - today.getTime()) / 86400000)
    if (days <= 7) {
      upcoming.push({ id: dog.id, name: dog.name, days, nextDate: next, turningAge: next.getFullYear() - birth.getFullYear() })
    }
  }
  return upcoming.sort((a, b) => a.days - b.days)
}

export function AdminDashboard() {
  const [routes, setRoutes] = useState<RouteWithEmployee[] | null>(null)
  const [clientCount, setClientCount] = useState<number | null>(null)
  const [dogCount, setDogCount] = useState<number | null>(null)
  const [birthdays, setBirthdays] = useState<UpcomingBirthday[]>([])

  useEffect(() => {
    const date = todayStr()
    supabase
      .from('routes')
      .select('*, employee:employees(*)')
      .eq('date', date)
      .order('route_number')
      .then(({ data }) => setRoutes((data as RouteWithEmployee[] | null) ?? []))

    supabase
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .then(({ count }) => setClientCount(count ?? 0))

    supabase
      .from('dogs')
      .select('*', { count: 'exact', head: true })
      .then(({ count }) => setDogCount(count ?? 0))

    supabase
      .from('dogs')
      .select('id, name, birthday')
      .not('birthday', 'is', null)
      .then(({ data }) => setBirthdays(getUpcomingBirthdays(data ?? [])))
  }, [])

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-extrabold text-ocean-900">🏝️ Admin Dashboard</h1>

      {birthdays.length > 0 && (
        <Card className="mb-6 bg-sun-50">
          <h2 className="mb-2 font-display text-lg font-bold text-ocean-900">🎂 Upcoming Birthdays</h2>
          <div className="flex flex-col gap-1">
            {birthdays.map((b) => (
              <p key={b.id} className="text-sm text-ocean-800">
                <span className="font-semibold">{b.name}</span> turns {b.turningAge}{' '}
                {b.days === 0 ? (
                  <span className="font-semibold text-sun-700">today!</span>
                ) : (
                  <>
                    in {b.days} day{b.days === 1 ? '' : 's'} (
                    {b.nextDate.toLocaleDateString('default', { month: 'short', day: 'numeric' })})
                  </>
                )}
              </p>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Clients" value={clientCount} />
        <StatCard label="Dogs" value={dogCount} />
        <StatCard label="Routes Today" value={routes?.length ?? null} />
      </div>

      <h2 className="mb-3 font-display text-lg font-bold text-ocean-800">Today's Routes</h2>
      {routes === null && (
        <div className="flex justify-center py-6">
          <Spinner className="h-8 w-8" />
        </div>
      )}
      <div className="flex flex-col gap-3">
        {routes?.map((route) => (
          <Card key={route.id} className="flex items-center justify-between">
            <div>
              <p className="font-display font-bold text-ocean-900">Route {route.route_number}</p>
              <p className="text-sm text-ocean-700/70">{route.employee?.display_name ?? 'Unassigned'}</p>
            </div>
            <StatusPill status={route.status} />
          </Card>
        ))}
        {routes?.length === 0 && (
          <Card>
            <p className="text-ocean-700/70">
              No routes set up for today yet. Head to{' '}
              <Link to="/admin/calendar" className="font-semibold text-ocean-600 hover:underline">
                Calendar
              </Link>{' '}
              and{' '}
              <Link to="/admin/routes" className="font-semibold text-ocean-600 hover:underline">
                Routes
              </Link>
              .
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number | null }) {
  return (
    <Card className="text-center">
      <p className="font-display text-3xl font-extrabold text-ocean-900">{value ?? '—'}</p>
      <p className="text-sm text-ocean-700/70">{label}</p>
    </Card>
  )
}

function StatusPill({ status }: { status: Route['status'] }) {
  const labels: Record<Route['status'], string> = {
    pending: 'Not started',
    in_progress: 'In progress',
    completed: 'Completed',
  }
  const colors: Record<Route['status'], string> = {
    pending: 'bg-sand-200 text-ocean-700',
    in_progress: 'bg-sun-100 text-sun-700',
    completed: 'bg-green-100 text-green-700',
  }
  return (
    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${colors[status]}`}>
      {labels[status]}
    </span>
  )
}
