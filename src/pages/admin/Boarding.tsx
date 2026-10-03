import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import type { AfterHoursTransport, Client, Dog, ScheduleEntry } from '@/types/database'

type Stay = ScheduleEntry & { dog: Dog & { client: Client }; transports: AfterHoursTransport[] }
type EmployeeOption = { id: string; display_name: string }
type Leg = 'pickup' | 'dropoff'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function dateStr(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`
}

function todayStr() {
  const d = new Date()
  return dateStr(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

function addDays(date: string, days: number) {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return dateStr(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

function nightsBetween(checkIn: string, checkOut: string) {
  return Math.round((new Date(checkOut + 'T00:00:00').getTime() - new Date(checkIn + 'T00:00:00').getTime()) / 86400000)
}

function formatDay(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** "18:30:00" -> "6:30 PM" */
function formatTimeOfDay(time: string) {
  const [h, m] = time.split(':').map(Number)
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`
}

export function AdminBoarding() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [stays, setStays] = useState<Stay[] | null>(null)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [editing, setEditing] = useState<Stay | 'new' | null>(null)

  const monthStart = dateStr(year, month, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const monthEnd = dateStr(year, month, daysInMonth)

  async function load() {
    const { data } = await supabase
      .from('schedule_entries')
      .select('*, dog:dogs(*, client:clients(*)), transports:after_hours_transports(*)')
      .eq('type', 'boarding')
      .eq('cancelled', false)
      .lte('check_in_date', monthEnd)
      .gte('check_out_date', monthStart)
      .order('check_in_date')
    setStays((data as Stay[] | null) ?? [])
  }

  useEffect(() => {
    setStays(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month])

  useEffect(() => {
    supabase.rpc('list_active_employees').then(({ data }) => setEmployees(data ?? []))
  }, [])

  function shiftMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
  }

  const leadingBlanks = new Date(year, month - 1, 1).getDay()
  const today = todayStr()

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-extrabold text-ocean-900">🧳 Boarding</h1>
        <Button onClick={() => setEditing('new')}>+ Book Boarding</Button>
      </div>

      <div className="mb-4 flex items-center justify-center gap-4">
        <button onClick={() => shiftMonth(-1)} className="text-2xl text-ocean-600" aria-label="Previous month">
          ‹
        </button>
        <p className="w-44 text-center font-display text-lg font-bold text-ocean-900">
          {MONTH_NAMES[month - 1]} {year}
        </p>
        <button onClick={() => shiftMonth(1)} className="text-2xl text-ocean-600" aria-label="Next month">
          ›
        </button>
      </div>

      {stays === null ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-8 w-8" />
        </div>
      ) : (
        <>
          <Card className="mb-8 p-2! sm:p-4!">
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAY_SHORT.map((d) => (
                <p key={d} className="pb-1 text-center text-xs font-semibold text-ocean-700/60">
                  {d}
                </p>
              ))}
              {Array.from({ length: leadingBlanks }, (_, i) => (
                <div key={`blank-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = dateStr(year, month, i + 1)
                const here = stays.filter((s) => s.check_in_date <= day && day <= s.check_out_date)
                return (
                  <div
                    key={day}
                    className={`min-h-20 min-w-0 rounded-lg border p-1 ${
                      day === today ? 'border-ocean-400 bg-ocean-50' : 'border-sand-200'
                    }`}
                  >
                    <p className="text-xs font-semibold text-ocean-700/70">{i + 1}</p>
                    <div className="flex flex-col gap-0.5">
                      {here.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setEditing(s)}
                          title={`${s.dog.name}: ${formatDay(s.check_in_date)} – ${formatDay(s.check_out_date)}`}
                          className={`truncate rounded px-1 text-left text-[11px] font-semibold ${
                            day === s.check_in_date
                              ? 'bg-green-100 text-green-800'
                              : day === s.check_out_date
                                ? 'bg-sun-100 text-sun-800'
                                : 'bg-ocean-100 text-ocean-800'
                          }`}
                        >
                          {day === s.check_in_date ? '→ ' : day === s.check_out_date ? '← ' : ''}
                          {s.dog.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-xs text-ocean-700/60">
              <span className="rounded bg-green-100 px-1 font-semibold text-green-800">→ Check-in</span>{' '}
              <span className="rounded bg-ocean-100 px-1 font-semibold text-ocean-800">Boarding</span>{' '}
              <span className="rounded bg-sun-100 px-1 font-semibold text-sun-800">← Check-out</span>
            </p>
          </Card>

          <h2 className="mb-3 font-display text-lg font-bold text-ocean-800">Stays this month</h2>
          <div className="flex flex-col gap-3">
            {stays.map((s) => (
              <StayCard key={s.id} stay={s} employees={employees} onOpen={() => setEditing(s)} />
            ))}
            {stays.length === 0 && <p className="text-sm text-ocean-700/50">No boarding booked this month.</p>}
          </div>
        </>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Book Boarding' : 'Boarding'}
      >
        {editing !== null && (
          <BoardingForm
            stay={editing === 'new' ? null : editing}
            employees={employees}
            onDone={() => {
              setEditing(null)
              load()
            }}
          />
        )}
      </Modal>
    </div>
  )
}

function legSummary(stay: Stay, leg: Leg, employees: EmployeeOption[]) {
  const t = stay.transports.find((x) => x.kind === leg)
  if (!t) {
    return leg === 'pickup' ? `With the ${formatDay(stay.check_in_date)} hike` : `After the ${formatDay(stay.check_out_date)} hike`
  }
  const who = employees.find((e) => e.id === t.employee_id)?.display_name ?? 'Unassigned'
  return `🌙 After hours ${formatDay(t.date)}, ${formatTimeOfDay(t.time)} · ${who}${t.status === 'done' ? ' ✅' : ''}`
}

function StayCard({ stay, employees, onOpen }: { stay: Stay; employees: EmployeeOption[]; onOpen: () => void }) {
  const nights = nightsBetween(stay.check_in_date, stay.check_out_date)
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-bold text-ocean-900">{stay.dog.name}</p>
          <p className="text-sm text-ocean-700/70">{stay.dog.client.main_name}</p>
          <p className="mt-1 text-sm font-semibold text-ocean-800">
            {formatDay(stay.check_in_date)} → {formatDay(stay.check_out_date)} · {nights} night{nights === 1 ? '' : 's'}
          </p>
        </div>
        <Button variant="ghost" onClick={onOpen}>
          Edit
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-1 border-t border-sand-200 pt-3 text-sm text-ocean-800 sm:grid-cols-2">
        <p>
          <span className="font-semibold">Pick up: </span>
          {legSummary(stay, 'pickup', employees)}
          {stay.pickup_status === 'picked_up' && ' ✅'}
        </p>
        <p>
          <span className="font-semibold">Drop off: </span>
          {legSummary(stay, 'dropoff', employees)}
          {stay.dropoff_status === 'dropped_off' && ' ✅'}
        </p>
      </div>
      {stay.belongings_notes && (
        <p className="mt-2 rounded-lg bg-sand-50 px-3 py-2 text-sm text-ocean-800">
          <span className="font-semibold">Belongings: </span>
          {stay.belongings_notes}
        </p>
      )}
    </Card>
  )
}

type LegForm = { afterHours: boolean; date: string; time: string; employeeId: string }

function legFormFor(stay: Stay | null, leg: Leg, fallbackDate: string): LegForm {
  const t = stay?.transports.find((x) => x.kind === leg)
  return t
    ? { afterHours: true, date: t.date, time: t.time.slice(0, 5), employeeId: t.employee_id ?? '' }
    : { afterHours: false, date: fallbackDate, time: '', employeeId: '' }
}

function BoardingForm({
  stay,
  employees,
  onDone,
}: {
  stay: Stay | null
  employees: EmployeeOption[]
  onDone: () => void
}) {
  const initialIn = stay?.check_in_date ?? todayStr()
  const initialOut = stay?.check_out_date ?? addDays(initialIn, 1)
  const [dogs, setDogs] = useState<Dog[]>([])
  const [dogSearch, setDogSearch] = useState('')
  const [dogId, setDogId] = useState(stay?.dog_id ?? '')
  const [checkIn, setCheckIn] = useState(initialIn)
  const [checkOut, setCheckOut] = useState(initialOut)
  const [pickup, setPickup] = useState<LegForm>(legFormFor(stay, 'pickup', initialIn))
  const [dropoff, setDropoff] = useState<LegForm>(legFormFor(stay, 'dropoff', initialOut))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (stay) return
    supabase
      .from('dogs')
      .select('*')
      .order('name')
      .then(({ data }) => setDogs(data ?? []))
  }, [stay])

  // After-hours legs on the check-in/out day move with it.
  function changeCheckIn(value: string) {
    if (pickup.date === checkIn) setPickup({ ...pickup, date: value })
    setCheckIn(value)
  }
  function changeCheckOut(value: string) {
    if (dropoff.date === checkOut) setDropoff({ ...dropoff, date: value })
    setCheckOut(value)
  }

  const nights = nightsBetween(checkIn, checkOut)

  async function handleSave() {
    setError(null)
    if (!dogId) return setError('Choose a dog.')
    if (!checkIn || !checkOut || nights < 1) return setError('Check-out must be at least one night after check-in.')
    for (const [label, leg] of [['pick up', pickup], ['drop off', dropoff]] as const) {
      if (leg.afterHours && (!leg.date || !leg.time || !leg.employeeId)) {
        return setError(`After hours ${label} needs a day, time and employee.`)
      }
    }

    setSaving(true)
    let entryId = stay?.id
    if (!entryId) {
      const { data, error } = await supabase.rpc('book_boarding', {
        p_dog_id: dogId,
        p_check_in: checkIn,
        p_check_out: checkOut,
      })
      if (error) {
        setSaving(false)
        return setError(error.message)
      }
      entryId = data as string
    } else if (checkIn !== stay!.check_in_date || checkOut !== stay!.check_out_date) {
      const { error } = await supabase.rpc('change_boarding_dates', {
        p_entry_id: entryId,
        p_check_in: checkIn,
        p_check_out: checkOut,
      })
      if (error) {
        setSaving(false)
        return setError(error.message)
      }
    }

    for (const [kind, leg] of [['pickup', pickup], ['dropoff', dropoff]] as const) {
      const had = stay?.transports.some((t) => t.kind === kind)
      const { error } = leg.afterHours
        ? await supabase.rpc('set_after_hours_transport', {
            p_entry_id: entryId,
            p_kind: kind,
            p_date: leg.date,
            p_time: leg.time,
            p_employee_id: leg.employeeId,
          })
        : had
          ? await supabase.rpc('remove_after_hours_transport', { p_entry_id: entryId, p_kind: kind })
          : { error: null }
      if (error) {
        setSaving(false)
        return setError(error.message)
      }
    }
    setSaving(false)
    onDone()
  }

  async function handleCancel() {
    if (!stay || !confirm(`Cancel ${stay.dog.name}'s boarding? Their regular hikes on those days come back.`)) return
    setSaving(true)
    const { error } = await supabase.rpc('cancel_boarding', { p_entry_id: stay.id })
    setSaving(false)
    if (error) return setError(error.message)
    onDone()
  }

  const filteredDogs = dogs.filter((d) => d.name.toLowerCase().includes(dogSearch.toLowerCase()))

  return (
    <div className="flex flex-col gap-4">
      {stay ? (
        <p className="font-display text-lg font-bold text-ocean-900">
          {stay.dog.name} <span className="text-sm font-normal text-ocean-700/70">{stay.dog.client.main_name}</span>
        </p>
      ) : dogId ? (
        <p className="font-display font-bold text-ocean-900">
          {dogs.find((d) => d.id === dogId)?.name}{' '}
          <button onClick={() => setDogId('')} className="text-sm font-normal text-ocean-600 hover:underline">
            change
          </button>
        </p>
      ) : (
        <div>
          <Input placeholder="Search dogs..." value={dogSearch} onChange={(e) => setDogSearch(e.target.value)} className="mb-2" />
          <div className="max-h-40 overflow-y-auto rounded-xl border border-sand-200">
            {filteredDogs.map((dog) => (
              <button
                key={dog.id}
                onClick={() => setDogId(dog.id)}
                className="block w-full px-3 py-2 text-left hover:bg-ocean-50"
              >
                {dog.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Input type="date" label="Check-in" value={checkIn} onChange={(e) => changeCheckIn(e.target.value)} />
        <Input type="date" label="Check-out" value={checkOut} min={addDays(checkIn, 1)} onChange={(e) => changeCheckOut(e.target.value)} />
      </div>
      {nights >= 1 && (
        <p className="-mt-2 text-sm font-semibold text-ocean-700/70">
          {nights} night{nights === 1 ? '' : 's'}
        </p>
      )}

      <LegFields
        title="Pick up"
        hikeLabel={`With the ${checkIn ? formatDay(checkIn) : 'check-in'} hike, then to the house`}
        leg={pickup}
        setLeg={setPickup}
        min={checkIn}
        max={checkOut}
        employees={employees}
      />
      <LegFields
        title="Drop off"
        hikeLabel={`After the ${checkOut ? formatDay(checkOut) : 'check-out'} hike`}
        leg={dropoff}
        setLeg={setDropoff}
        min={checkIn}
        max={checkOut}
        employees={employees}
      />

      {stay?.belongings_notes && (
        <p className="rounded-lg bg-sand-50 px-3 py-2 text-sm text-ocean-800">
          <span className="font-semibold">Belongings: </span>
          {stay.belongings_notes}
        </p>
      )}

      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}

      <Button onClick={handleSave} disabled={saving} fullWidth>
        {saving ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : stay ? 'Save Changes' : 'Book Boarding'}
      </Button>
      {stay && (
        <button
          onClick={handleCancel}
          disabled={saving}
          className="text-sm font-semibold text-red-600 hover:underline disabled:opacity-50"
        >
          Cancel this boarding
        </button>
      )}
    </div>
  )
}

function LegFields({
  title,
  hikeLabel,
  leg,
  setLeg,
  min,
  max,
  employees,
}: {
  title: string
  hikeLabel: string
  leg: LegForm
  setLeg: (leg: LegForm) => void
  min: string
  max: string
  employees: EmployeeOption[]
}) {
  return (
    <div className="rounded-xl border border-sand-200 p-3">
      <p className="mb-2 font-semibold text-ocean-900">{title}</p>
      <label className="flex items-center gap-2 text-sm text-ocean-800">
        <input type="radio" checked={!leg.afterHours} onChange={() => setLeg({ ...leg, afterHours: false })} />
        {hikeLabel}
      </label>
      <label className="mt-1 flex items-center gap-2 text-sm text-ocean-800">
        <input type="radio" checked={leg.afterHours} onChange={() => setLeg({ ...leg, afterHours: true })} />
        🌙 After Hours Transportation
      </label>
      {leg.afterHours && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Input type="date" label="Day" value={leg.date} min={min} max={max} onChange={(e) => setLeg({ ...leg, date: e.target.value })} />
          <Input type="time" label="Time" value={leg.time} onChange={(e) => setLeg({ ...leg, time: e.target.value })} />
          <div className="col-span-2">
            <Select label="Employee" value={leg.employeeId} onChange={(e) => setLeg({ ...leg, employeeId: e.target.value })}>
              <option value="">Choose...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.display_name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}
    </div>
  )
}
