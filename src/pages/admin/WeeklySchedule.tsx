import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { CancelScheduleForm } from '@/components/CancelScheduleForm'
import type { Dog, ScheduleEntry } from '@/types/database'

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function dateStr(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`
}

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
}

export function WeeklySchedule() {
  const [dogs, setDogs] = useState<Dog[] | null>(null)
  const [dogSearch, setDogSearch] = useState('')
  const [selectedDog, setSelectedDog] = useState<Dog | null>(null)
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [pattern, setPattern] = useState<Map<number, number | null>>(new Map())
  const [entries, setEntries] = useState<ScheduleEntry[] | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ScheduleEntry | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase
      .from('dogs')
      .select('*')
      .order('name')
      .then(({ data }) => setDogs(data ?? []))
  }, [])

  async function loadMonth() {
    if (!selectedDog) return
    setLoading(true)

    await supabase.rpc('ensure_schedule_for_month', { p_year: year, p_month: month })

    const [{ data: patternRows }, { data: entryRows }] = await Promise.all([
      supabase.from('dog_weekly_pattern').select('*').eq('dog_id', selectedDog.id),
      supabase
        .from('schedule_entries')
        .select('*')
        .eq('dog_id', selectedDog.id)
        .eq('type', 'hike')
        .gte('check_in_date', dateStr(year, month, 1))
        .lt('check_in_date', dateStr(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1)),
    ])

    setPattern(new Map((patternRows ?? []).map((p) => [p.day_of_week, p.default_route_number])))
    setEntries(entryRows ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadMonth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDog, year, month])

  async function toggleWeekday(day: number) {
    if (!selectedDog) return
    if (pattern.has(day)) {
      await supabase.from('dog_weekly_pattern').delete().eq('dog_id', selectedDog.id).eq('day_of_week', day)
    } else {
      await supabase.from('dog_weekly_pattern').insert({ dog_id: selectedDog.id, day_of_week: day })
    }
    // Backfill this month and next so the new pattern is already in place
    // for "next week" without waiting on someone to open that month later.
    await supabase.rpc('ensure_schedule_for_month', { p_year: year, p_month: month })
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    await supabase.rpc('ensure_schedule_for_month', { p_year: nextYear, p_month: nextMonth })
    loadMonth()
  }

  async function setDayRoute(day: number, routeNumber: number | null) {
    if (!selectedDog) return
    await supabase.rpc('set_default_route', {
      p_dog_id: selectedDog.id,
      p_day_of_week: day,
      p_route_number: routeNumber,
    })
    // If routes already exist for occurrences of this weekday in the visible
    // month, slot the dog into them right away instead of waiting for the
    // next time someone opens the Routes page.
    const matchingDates = (entries ?? [])
      .filter((e) => new Date(e.check_in_date + 'T00:00:00').getDay() === day)
      .map((e) => e.check_in_date)
    for (const d of matchingDates) {
      await supabase.rpc('apply_default_routes_for_date', { p_date: d })
    }
    loadMonth()
  }

  async function handleAddOneOff(date: string) {
    if (!selectedDog) return
    await supabase.from('schedule_entries').insert({
      dog_id: selectedDog.id,
      type: 'hike',
      check_in_date: date,
      check_out_date: date,
      scheduled_pickup_date: date,
      scheduled_dropoff_date: date,
    })
    loadMonth()
  }

  async function handleRestore(entry: ScheduleEntry) {
    if (!confirm('Restore this hike day?')) return
    await supabase
      .from('schedule_entries')
      .update({ cancelled: false, cancel_reason: null, late_cancel: false })
      .eq('id', entry.id)
    loadMonth()
  }

  function prevMonth() {
    if (month === 1) {
      setMonth(12)
      setYear(year - 1)
    } else {
      setMonth(month - 1)
    }
  }

  function nextMonth() {
    if (month === 12) {
      setMonth(1)
      setYear(year + 1)
    } else {
      setMonth(month + 1)
    }
  }

  const filteredDogs = dogs?.filter((d) => d.name.toLowerCase().includes(dogSearch.toLowerCase()))
  const entryByDate = new Map((entries ?? []).map((e) => [e.check_in_date, e]))
  const firstWeekday = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-extrabold text-ocean-900">🗓️ Weekly Schedule</h1>
      <p className="mb-6 text-ocean-700/70">
        Set each dog's regular hike days — they'll repeat automatically every week.
      </p>

      {!selectedDog ? (
        <Card>
          <Input
            placeholder="Search dogs..."
            value={dogSearch}
            onChange={(e) => setDogSearch(e.target.value)}
            className="mb-3"
          />
          {!dogs && (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          )}
          <div className="max-h-80 overflow-y-auto">
            {filteredDogs?.map((dog) => (
              <button
                key={dog.id}
                onClick={() => setSelectedDog(dog)}
                className="block w-full rounded-xl px-3 py-2 text-left font-semibold text-ocean-800 hover:bg-ocean-50"
              >
                {dog.name}
              </button>
            ))}
            {filteredDogs?.length === 0 && (
              <p className="py-4 text-center text-ocean-700/50">No dogs found.</p>
            )}
          </div>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="font-display text-lg font-bold text-ocean-900">{selectedDog.name}</p>
              <button
                onClick={() => setSelectedDog(null)}
                className="text-sm font-semibold text-ocean-600 hover:underline"
              >
                Change dog
              </button>
            </div>
            <p className="mb-2 text-sm font-semibold text-ocean-800">Regular hike days</p>
            <div className="flex gap-2">
              {WEEKDAY_LABELS.map((label, day) => (
                <button
                  key={day}
                  onClick={() => toggleWeekday(day)}
                  className={`h-10 w-10 rounded-full font-display font-bold transition-colors ${
                    pattern.has(day)
                      ? 'bg-ocean-600 text-white'
                      : 'bg-sand-100 text-ocean-700 hover:bg-sand-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {pattern.size > 0 && (
              <div className="mt-5 rounded-2xl bg-sun-50 p-4">
                <p className="mb-3 font-display font-bold text-ocean-900">
                  🚐 Default Route — pick which route this dog rides on each hike day
                </p>
                <div className="flex flex-col gap-2">
                  {WEEKDAY_FULL.map((fullLabel, day) =>
                    pattern.has(day) ? (
                      <div
                        key={day}
                        className="flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-3"
                      >
                        <p className="font-semibold text-ocean-900">{fullLabel}</p>
                        <Select
                          value={pattern.get(day) ?? ''}
                          onChange={(e) => setDayRoute(day, e.target.value ? Number(e.target.value) : null)}
                          className="w-40"
                        >
                          <option value="">No default route</option>
                          <option value="1">Route 1</option>
                          <option value="2">Route 2</option>
                          <option value="3">Route 3</option>
                        </Select>
                      </div>
                    ) : null
                  )}
                </div>
              </div>
            )}

            <p className="mt-3 text-xs text-ocean-700/50">
              Toggling a day sets the recurring schedule for every week going forward. Set a default
              route per day above so the dog auto-fills onto that route number whenever it's built,
              e.g. Mon/Wed/Fri → Route 1, Tue/Thu → Route 2. Turning a day off only stops future
              weeks — already-scheduled upcoming days need to be cancelled individually below.
            </p>
          </Card>

          <div className="mb-4 flex items-center justify-center gap-4">
            <button onClick={prevMonth} className="text-2xl text-ocean-600">
              ‹
            </button>
            <p className="font-display text-lg font-bold text-ocean-900">{monthLabel(year, month)}</p>
            <button onClick={nextMonth} className="text-2xl text-ocean-600">
              ›
            </button>
          </div>

          {loading && (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          )}

          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {WEEKDAY_LABELS.map((label, i) => (
              <div key={i} className="text-center text-xs font-semibold text-ocean-700/50">
                {label}
              </div>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <div key={`blank-${i}`} />
              const date = dateStr(year, month, day)
              const entry = entryByDate.get(date)
              return (
                <DayCell
                  key={date}
                  day={day}
                  entry={entry}
                  onAdd={() => handleAddOneOff(date)}
                  onCancel={() => entry && setCancelTarget(entry)}
                  onRestore={() => entry && handleRestore(entry)}
                />
              )
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-xs text-ocean-700/60">
            <Legend swatch="bg-ocean-600" label="Scheduled" />
            <Legend swatch="bg-sand-200" label="Cancelled" />
            <Legend swatch="bg-sand-50 border border-sand-300" label="Not scheduled (click to add)" />
          </div>
        </>
      )}

      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title="Cancel this hike">
        {cancelTarget && (
          <CancelScheduleForm
            entry={cancelTarget}
            onDone={() => {
              setCancelTarget(null)
              loadMonth()
            }}
          />
        )}
      </Modal>
    </div>
  )
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded ${swatch}`} />
      {label}
    </div>
  )
}

function DayCell({
  day,
  entry,
  onAdd,
  onCancel,
  onRestore,
}: {
  day: number
  entry: ScheduleEntry | undefined
  onAdd: () => void
  onCancel: () => void
  onRestore: () => void
}) {
  if (!entry) {
    return (
      <button
        onClick={onAdd}
        className="flex aspect-square flex-col items-center justify-center rounded-lg border border-sand-300 bg-sand-50 text-sm font-semibold text-ocean-700/40 hover:border-ocean-400 hover:text-ocean-600"
        title="Add a one-off hike day"
      >
        {day}
      </button>
    )
  }

  if (entry.cancelled) {
    return (
      <button
        onClick={onRestore}
        className="flex aspect-square flex-col items-center justify-center rounded-lg bg-sand-200 text-sm font-semibold text-ocean-700/70"
        title={`Cancelled${entry.cancel_reason ? ` — ${entry.cancel_reason}` : ''}${entry.late_cancel ? ' (late cancel)' : ''}. Click to restore.`}
      >
        <span className="line-through">{day}</span>
        <span className="text-[9px] normal-case">{entry.cancel_reason ?? 'cancelled'}</span>
      </button>
    )
  }

  return (
    <button
      onClick={onCancel}
      className="flex aspect-square flex-col items-center justify-center rounded-lg bg-ocean-600 text-sm font-bold text-white hover:bg-ocean-700"
      title="Click to cancel this day"
    >
      {day}
    </button>
  )
}
