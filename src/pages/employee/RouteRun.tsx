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

  async function handleStart() {
    setStarting(true)
    await supabase.rpc('start_route', { p_route_id: routeId! })
    await load()
    setStarting(false)
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

  const pendingDropoffs = dropoffs.filter(
    (e) => e.dropoff_status === 'pending' && !e.late_pickup_by_owner
  ).length
  const readyForShiftEnd = route.status === 'in_progress' && pendingDropoffs === 0

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

      {route.status === 'pending' && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-ocean-800">Ready to head out?</p>
          <Button onClick={handleStart} disabled={starting}>
            {starting ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Start Route'}
          </Button>
        </Card>
      )}

      {route.status !== 'pending' && (
        <>
          <Section title="🚗 Pick Up">
            {pickups.map((entry) => (
              <PickupCard key={entry.id} entry={entry} routeStarted onLogged={load} />
            ))}
            {pickups.length === 0 && <EmptyRow text="No pickups on this route." />}
          </Section>

          <Section title="🏞️ Farm">
            <FarmTimes route={route} onLogged={load} />
          </Section>

          <Section title="🏠 Drop Off">
            {dropoffs.map((entry) => (
              <DropoffCard key={entry.id} entry={entry} onLogged={load} />
            ))}
            {dropoffs.length === 0 && <EmptyRow text="No dropoffs on this route." />}
          </Section>

          {route.status === 'in_progress' && (
            <Card className="mt-6 flex flex-wrap items-center justify-between gap-3 bg-sun-50">
              <p className="text-ocean-800">
                {readyForShiftEnd
                  ? "All dogs dropped off — you're ready to close out the day."
                  : `${pendingDropoffs} drop-off${pendingDropoffs === 1 ? '' : 's'} left before you can end your shift.`}
              </p>
              <Button disabled={!readyForShiftEnd} onClick={() => navigate(`/end-of-shift/${routeId}`)}>
                End of Shift
              </Button>
            </Card>
          )}

          {route.status === 'completed' && (
            <Card className="mt-6 bg-green-50 text-center">
              <p className="font-display font-bold text-green-700">
                Shift complete for this route. Nice work! 🎉
              </p>
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
      <Link to={`/clients/${dog.client.id}`} className="text-sm font-semibold text-ocean-600 hover:underline">
        View client info →
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
  onLogged,
}: {
  entry: EntryWithDog
  routeStarted: boolean
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
        ) : (
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
      {!done && (
        <NoteToggle showNote={showNote} setShowNote={setShowNote} note={note} setNote={setNote} />
      )}
    </Card>
  )
}

function DropoffCard({ entry, onLogged }: { entry: EntryWithDog; onLogged: () => void }) {
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
        ) : (
          <Button onClick={handleLog} disabled={submitting}>
            {submitting ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Log Dropoff'}
          </Button>
        )}
      </div>
      {entry.dog.client.dropoff_notes && (
        <p className="mt-2 text-sm text-ocean-700/70">Note: {entry.dog.client.dropoff_notes}</p>
      )}
      {!done && !entry.late_pickup_by_owner && (
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
