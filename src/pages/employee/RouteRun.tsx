import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type { Client, Dog, Route, ScheduleEntry } from '@/types/database'

type EntryWithDog = ScheduleEntry & { dog: Dog & { client: Client } }

export function RouteRun() {
  const { routeId } = useParams<{ routeId: string }>()
  const navigate = useNavigate()
  const [route, setRoute] = useState<Route | null>(null)
  const [entries, setEntries] = useState<EntryWithDog[] | null>(null)
  const [starting, setStarting] = useState(false)
  const [clockingOut, setClockingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const [{ data: routeData }, { data: entryData }] = await Promise.all([
      supabase.from('routes').select('*').eq('id', routeId).single(),
      supabase
        .from('schedule_entries')
        .select('*, dog:dogs(*, client:clients(*))')
        .or(`pickup_route_id.eq.${routeId},dropoff_route_id.eq.${routeId}`),
    ])
    setRoute(routeData)
    setEntries((entryData as EntryWithDog[] | null) ?? [])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId])

  async function handleClockIn() {
    setStarting(true)
    setError(null)
    const { error } = await supabase.rpc('start_route', { p_route_id: routeId! })
    if (error) setError(error.message)
    await load()
    setStarting(false)
  }

  async function handleClockOut() {
    setClockingOut(true)
    setError(null)
    const { error } = await supabase.rpc('clock_out', { p_route_id: routeId! })
    setClockingOut(false)
    if (error) setError(error.message)
    await load()
  }

  if (!route || entries === null) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  const pickups = entries
    .filter((e) => e.pickup_route_id === routeId)
    .sort((a, b) => (a.pickup_route_order ?? 0) - (b.pickup_route_order ?? 0))
  const dropoffs = entries
    .filter((e) => e.dropoff_route_id === routeId)
    .sort((a, b) => (a.dropoff_route_order ?? 0) - (b.dropoff_route_order ?? 0))

  // A stop is one owner: all their dogs, picked up and dropped off, count
  // once for the day. Late cancels still count since the driver went there.
  const totalStops = new Set(
    entries.filter((e) => !e.cancelled || e.late_cancel).map((e) => e.dog.client_id)
  ).size

  const pendingDropoffs = dropoffs.filter(
    (e) => e.dropoff_status === 'pending' && !e.late_pickup_by_owner
  ).length
  const clockedOut = route.clocked_out_at !== null
  // Dogs can only be logged after clocking in and before the end of shift
  // report; clocking out comes last, once the report is in.
  const canLog = route.status === 'in_progress'
  const allDroppedOff = pendingDropoffs === 0

  return (
    <div>
      <button
        onClick={() => navigate('/today')}
        className="mb-4 text-sm font-semibold text-ocean-600 hover:underline"
      >
        ← Back to today
      </button>

      <h1 className="mb-4 font-display text-2xl font-extrabold text-ocean-900">
        Route {route.route_number}
      </h1>

      <Card className="mb-6 bg-ocean-50">
        <p className="font-display text-xl font-bold text-ocean-900">
          🚏 {totalStops} stop{totalStops === 1 ? '' : 's'} today
        </p>
        {(route.clocked_in_at || route.clocked_out_at) && (
          <p className="mt-1 text-sm text-ocean-700/70">
            {route.clocked_in_at && `Clocked in ${formatTime(route.clocked_in_at)}`}
            {route.clocked_in_at && route.clocked_out_at && ' · '}
            {route.clocked_out_at && `Clocked out ${formatTime(route.clocked_out_at)}`}
          </p>
        )}
      </Card>

      {error && <p className="mb-4 text-sm font-semibold text-red-600">{error}</p>}

      {route.status === 'pending' && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-ocean-800">Clock in to start your route.</p>
          <Button onClick={handleClockIn} disabled={starting}>
            {starting ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : "☀️ Let's Start the Day!"}
          </Button>
        </Card>
      )}

      {route.status !== 'pending' && (
        <>
          <Section title="🚗 Pick Up">
            {pickups.map((entry) => (
              <PickupCard key={entry.id} entry={entry} canLog={canLog} onLogged={load} />
            ))}
            {pickups.length === 0 && <EmptyRow text="No pickups on this route." />}
          </Section>

          <Section title="🏞️ Farm">
            <FarmTimes route={route} onLogged={load} />
          </Section>

          <Section title="🏠 Drop Off">
            {dropoffs.map((entry) => (
              <DropoffCard key={entry.id} entry={entry} canLog={canLog} onLogged={load} />
            ))}
            {dropoffs.length === 0 && <EmptyRow text="No dropoffs on this route." />}
          </Section>

          {canLog && (
            <Card className="mt-6 flex flex-wrap items-center justify-between gap-3 bg-sun-50">
              <p className="text-ocean-800">
                {allDroppedOff
                  ? 'All dogs dropped off — fill out your end of shift report.'
                  : `${pendingDropoffs} drop-off${pendingDropoffs === 1 ? '' : 's'} left before your end of shift report.`}
              </p>
              <Button disabled={!allDroppedOff} onClick={() => navigate(`/end-of-shift/${routeId}`)}>
                End of Shift Report
              </Button>
            </Card>
          )}

          {/* Routes from before clock-in existed have nothing to clock out of. */}
          {route.status === 'completed' && route.clocked_in_at && !clockedOut && (
            <Card className="mt-6 flex flex-wrap items-center justify-between gap-3 bg-sun-50">
              <p className="text-ocean-800">Report sent — last step is to clock out.</p>
              <Button disabled={clockingOut} onClick={handleClockOut}>
                {clockingOut ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Route finished! Clock out!'}
              </Button>
            </Card>
          )}

          {clockedOut && (
            <Card className="mt-6 flex flex-col items-center gap-3 bg-ocean-50 py-8 text-center">
              <PawPrint className="h-14 w-14 text-ocean-500" />
              <p className="font-display text-3xl font-extrabold text-ocean-900">You're Awesome!</p>
              <Button onClick={() => navigate('/today')}>Back to Today</Button>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="mb-3 font-display text-lg font-bold text-ocean-800">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

function PawPrint({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" className={className}>
      <ellipse cx="14" cy="26" rx="6.5" ry="8.5" transform="rotate(-20 14 26)" />
      <ellipse cx="25" cy="13" rx="6.5" ry="9" transform="rotate(-8 25 13)" />
      <ellipse cx="39" cy="13" rx="6.5" ry="9" transform="rotate(8 39 13)" />
      <ellipse cx="50" cy="26" rx="6.5" ry="8.5" transform="rotate(20 50 26)" />
      <path d="M32 30c-8 0-17 12-17 20 0 6 5 9 10 8 3-.5 5-2 7-2s4 1.5 7 2c5 1 10-2 10-8 0-8-9-20-17-20z" />
    </svg>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <p className="text-sm text-ocean-700/50">{text}</p>
}

function DogInfo({ dog }: { dog: Dog & { client: Client } }) {
  return (
    <div>
      <p className="font-display text-lg font-bold text-ocean-900">
        {dog.name}
        {dog.seating_position && (
          <span className="ml-2 text-sm font-normal text-ocean-700/60">
            seat: {dog.seating_position}
          </span>
        )}
      </p>
      <p className="text-sm text-ocean-700/70">{dog.client.main_name}</p>
      {dog.client.address && <p className="text-sm text-ocean-700/70">{dog.client.address}</p>}
      <Link to={`/dogs/${dog.client.id}`} className="text-sm font-semibold text-ocean-600 hover:underline">
        View dog info →
      </Link>
    </div>
  )
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('default', { hour: 'numeric', minute: '2-digit' })
}

function FarmTimes({ route, onLogged }: { route: Route; onLogged: () => void }) {
  const [submitting, setSubmitting] = useState<'arrival' | 'departure' | null>(null)

  async function handleArrival() {
    setSubmitting('arrival')
    await supabase.rpc('log_farm_arrival', { p_route_id: route.id })
    setSubmitting(null)
    onLogged()
  }

  async function handleDeparture() {
    setSubmitting('departure')
    await supabase.rpc('log_farm_departure', { p_route_id: route.id })
    setSubmitting(null)
    onLogged()
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold text-ocean-900">Arrived at Farm</p>
        {route.arrived_at_farm_at ? (
          <span className="font-semibold text-green-600">{formatTime(route.arrived_at_farm_at)} ✅</span>
        ) : (
          <Button onClick={handleArrival} disabled={submitting === 'arrival'}>
            {submitting === 'arrival' ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Log Arrival'}
          </Button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-sand-200 pt-3">
        <p className="font-semibold text-ocean-900">Left Farm</p>
        {route.left_farm_at ? (
          <span className="font-semibold text-green-600">{formatTime(route.left_farm_at)} ✅</span>
        ) : (
          <Button onClick={handleDeparture} disabled={submitting === 'departure' || !route.arrived_at_farm_at}>
            {submitting === 'departure' ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Log Departure'}
          </Button>
        )}
      </div>
    </Card>
  )
}

function PickupCard({
  entry,
  canLog,
  onLogged,
}: {
  entry: EntryWithDog
  canLog: boolean
  onLogged: () => void
}) {
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const done = entry.pickup_status === 'picked_up'
  const busy = submitting || cancelling

  async function handleLog() {
    setSubmitting(true)
    await supabase.rpc('log_pickup', { p_schedule_entry_id: entry.id, p_note: note || undefined })
    setSubmitting(false)
    onLogged()
  }

  async function handleLateCancel() {
    if (!confirm(`Mark ${entry.dog.name} as a late cancel? This cancels today's hike since the dog wasn't there.`)) {
      return
    }
    setCancelling(true)
    await supabase.rpc('log_late_cancel', { p_schedule_entry_id: entry.id, p_note: note || undefined })
    setCancelling(false)
    onLogged()
  }

  return (
    <Card className={done ? 'border-green-300 bg-green-50' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <DogInfo dog={entry.dog} />
        {done ? (
          <span className="font-semibold text-green-600">Picked up ✅</span>
        ) : !canLog ? null : (
          <div className="flex flex-col items-end gap-2">
            <Button onClick={handleLog} disabled={busy}>
              {submitting ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Log Pickup'}
            </Button>
            <button
              onClick={handleLateCancel}
              disabled={busy}
              className="text-xs font-semibold text-ocean-700/60 hover:text-ocean-800 disabled:opacity-50"
            >
              {cancelling ? 'Cancelling…' : '🚫 Not there — late cancel'}
            </button>
          </div>
        )}
      </div>
      {entry.dog.client.gate_code && (
        <p className="mt-2 text-sm text-ocean-700/70">Gate code: {entry.dog.client.gate_code}</p>
      )}
      {entry.dog.client.pickup_notes && (
        <p className="mt-1 text-sm text-ocean-700/70">Note: {entry.dog.client.pickup_notes}</p>
      )}
      {!done && canLog && (
        <NoteToggle showNote={showNote} setShowNote={setShowNote} note={note} setNote={setNote} />
      )}
    </Card>
  )
}

function DropoffCard({
  entry,
  canLog,
  onLogged,
}: {
  entry: EntryWithDog
  canLog: boolean
  onLogged: () => void
}) {
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const done = entry.dropoff_status === 'dropped_off'

  async function handleLog() {
    setSubmitting(true)
    await supabase.rpc('log_dropoff', { p_schedule_entry_id: entry.id, p_note: note || undefined })
    setSubmitting(false)
    onLogged()
  }

  return (
    <Card className={done ? 'border-green-300 bg-green-50' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <DogInfo dog={entry.dog} />
        {entry.late_pickup_by_owner ? (
          <span className="rounded-full bg-sun-100 px-3 py-1 text-sm font-semibold text-sun-700">
            Owner picking up late
          </span>
        ) : done ? (
          <span className="font-semibold text-green-600">Dropped off ✅</span>
        ) : !canLog ? null : (
          <Button onClick={handleLog} disabled={submitting}>
            {submitting ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Log Dropoff'}
          </Button>
        )}
      </div>
      {entry.dog.client.dropoff_notes && (
        <p className="mt-2 text-sm text-ocean-700/70">Note: {entry.dog.client.dropoff_notes}</p>
      )}
      {!done && !entry.late_pickup_by_owner && canLog && (
        <NoteToggle showNote={showNote} setShowNote={setShowNote} note={note} setNote={setNote} />
      )}
    </Card>
  )
}

function NoteToggle({
  showNote,
  setShowNote,
  note,
  setNote,
}: {
  showNote: boolean
  setShowNote: (v: boolean) => void
  note: string
  setNote: (v: string) => void
}) {
  return (
    <div className="mt-2">
      {!showNote ? (
        <button
          onClick={() => setShowNote(true)}
          className="text-sm font-semibold text-ocean-700 hover:underline"
        >
          ⚠️ Report an issue
        </button>
      ) : (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What happened?"
          className="mt-1 w-full rounded-xl border border-sand-300 px-3 py-2 text-sm"
        />
      )}
    </div>
  )
}
