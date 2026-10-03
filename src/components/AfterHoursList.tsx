import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'
import type { AfterHoursTransport, Client, Dog, ScheduleEntry } from '@/types/database'

type TransportWithStay = AfterHoursTransport & {
  entry: ScheduleEntry & { dog: Dog & { client: Client } }
}

/** "18:30:00" -> "6:30 PM" */
function formatTimeOfDay(time: string) {
  const [h, m] = time.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

function formatDay(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })
}

/**
 * The signed-in employee's After Hours Transports (boarding pickups and
 * dropoffs at a set time) between two dates, inclusive. Today's can be logged
 * from here; later ones are shown for planning.
 */
export function AfterHoursList({
  employeeId,
  from,
  to,
  canLog,
}: {
  employeeId: string
  from: string
  to: string
  canLog: boolean
}) {
  const [transports, setTransports] = useState<TransportWithStay[]>([])

  async function load() {
    const { data } = await supabase
      .from('after_hours_transports')
      .select('*, entry:schedule_entries(*, dog:dogs(*, client:clients(*)))')
      .eq('employee_id', employeeId)
      .gte('date', from)
      .lte('date', to)
      .order('date')
      .order('time')
    setTransports(((data as TransportWithStay[] | null) ?? []).filter((t) => !t.entry.cancelled))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, from, to])

  if (transports.length === 0) return null

  return (
    <div className="mt-6">
      <h2 className="mb-3 font-display text-lg font-bold text-ocean-800">🌙 After Hours Transportation</h2>
      <div className="flex flex-col gap-3">
        {transports.map((t) => (
          <TransportCard key={t.id} transport={t} canLog={canLog} onLogged={load} />
        ))}
      </div>
    </div>
  )
}

function TransportCard({
  transport,
  canLog,
  onLogged,
}: {
  transport: TransportWithStay
  canLog: boolean
  onLogged: () => void
}) {
  const [belongings, setBelongings] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { entry } = transport
  const { dog } = entry
  const isPickup = transport.kind === 'pickup'
  const done = transport.status === 'done'

  async function handleLog() {
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.rpc('log_after_hours_transport', {
      p_transport_id: transport.id,
      p_belongings: belongings || undefined,
    })
    setSubmitting(false)
    if (error) return setError(error.message)
    onLogged()
  }

  return (
    <Card className={done ? 'border-green-300 bg-green-50' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ocean-600">
            {formatDay(transport.date)} · {formatTimeOfDay(transport.time)} ·{' '}
            {isPickup ? "Pick up → bring to Jaime's" : 'Drop off → take home'}
          </p>
          <p className="font-display text-lg font-bold text-ocean-900">{dog.name}</p>
          <p className="text-sm text-ocean-700/70">{dog.client.main_name}</p>
          {dog.client.address && <p className="text-sm text-ocean-700/70">{dog.client.address}</p>}
          <Link to={`/dogs/${dog.client.id}`} className="text-sm font-semibold text-ocean-600 hover:underline">
            View dog info →
          </Link>
        </div>
        {done ? (
          <span className="font-semibold text-green-600">{isPickup ? 'Picked up ✅' : 'Dropped off ✅'}</span>
        ) : (
          canLog && (
            <Button onClick={handleLog} disabled={submitting}>
              {submitting ? (
                <Spinner className="h-5 w-5 border-white/40 border-t-white" />
              ) : isPickup ? (
                'Log Pickup'
              ) : (
                'Log Dropoff'
              )}
            </Button>
          )
        )}
      </div>
      {dog.client.gate_code && <p className="mt-2 text-sm text-ocean-700/70">Gate code: {dog.client.gate_code}</p>}
      {isPickup && !done && canLog && (
        <textarea
          value={belongings}
          onChange={(e) => setBelongings(e.target.value)}
          placeholder="Notes (include belongings): bed, toys, food, medication..."
          aria-label="Notes (include belongings)"
          className="mt-3 w-full rounded-xl border border-sand-300 px-3 py-2 text-sm"
        />
      )}
      {entry.belongings_notes && (
        <p className="mt-2 text-sm text-ocean-800">
          <span className="font-semibold">{isPickup ? 'Belongings: ' : 'Send home: '}</span>
          {entry.belongings_notes}
        </p>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-red-600">{error}</p>}
    </Card>
  )
}
