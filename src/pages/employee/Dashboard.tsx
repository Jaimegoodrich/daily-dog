import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/contexts/AuthContext'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type { Route } from '@/types/database'

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good Morning'
  if (hour < 17) return 'Good Afternoon'
  return 'Good Evening'
}

export function EmployeeDashboard() {
  const { employee } = useAuth()
  const navigate = useNavigate()
  const [routes, setRoutes] = useState<Route[] | null>(null)

  useEffect(() => {
    if (!employee) return
    const today = new Date().toISOString().slice(0, 10)
    supabase
      .from('routes')
      .select('*')
      .eq('date', today)
      .eq('employee_id', employee.id)
      .order('route_number')
      .then(({ data }) => setRoutes(data ?? []))
  }, [employee])

  return (
    <div>
      <h1 className="mb-1 font-display text-3xl font-extrabold text-ocean-900">
        {greeting()}, {employee?.display_name}!
      </h1>
      <p className="mb-6 text-ocean-700/70">Here's your day 🌊</p>

      {routes === null && (
        <div className="flex justify-center py-10">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      {routes?.length === 0 && (
        <Card>
          <p className="text-center text-ocean-700/70">
            No route assigned to you today. Enjoy the day off! 🏖️
          </p>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {routes?.map((route) => (
          <Card key={route.id} className="flex items-center justify-between">
            <div>
              <p className="font-display text-lg font-bold text-ocean-900">
                Route {route.route_number}
              </p>
              <StatusBadge status={route.status} />
            </div>
            <Button onClick={() => navigate(`/route/${route.id}`)}>
              {route.status === 'completed' ? 'View Route' : 'Open Route'}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: Route['status'] }) {
  const labels: Record<Route['status'], string> = {
    pending: 'Not started',
    in_progress: 'In progress',
    completed: 'Completed ✅',
  }
  const colors: Record<Route['status'], string> = {
    pending: 'text-ocean-700/60',
    in_progress: 'text-sun-600',
    completed: 'text-green-600',
  }
  return <p className={`text-sm font-semibold ${colors[status]}`}>{labels[status]}</p>
}
