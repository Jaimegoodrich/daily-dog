import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { CancelScheduleForm } from '@/components/CancelScheduleForm'
import { useRoutesForDay, type EntryWithDog } from '@/hooks/useRoutesForDay'
import type { Dog, Route, ScheduleEntry, ScheduleType } from '@/types/database'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function AdminCalendar() {
  const [date, setDate] = useState(todayStr())
  const { routes, entries, loading, load, assignPickup, assignDropoff, setDefaultRoute } = useRoutesForDay(date)
  const [editing, setEditing] = useState<Partial<ScheduleEntry> | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ScheduleEntry | null>(null)

  async function handleDelete(id: string) {
    if (!confirm('Remove this schedule entry?')) return
    await supabase.from('schedule_entries').delete().eq('id', id)
    load()
  }

  const activePickups = entries.filter((e) => e.scheduled_pickup_date === date && !e.cancelled)
  const activeDropoffs = entries.filter(
    (e) => e.scheduled_dropoff_date === date && !e.cancelled && !e.late_pickup_by_owner
  )
  const ownerDropoffs = entries.filter(
    (e) => e.scheduled_dropoff_date === date && !e.cancelled && e.late_pickup_by_owner
  )
  const cancelledToday = entries.filter(
    (e) => e.cancelled && (e.scheduled_pickup_date === date || e.scheduled_dropoff_date === date)
  )
  const unassignedPickups = activePickups.filter((e) => !e.pickup_route_id)
  const unassignedDropoffs = activeDropoffs.filter((e) => !e.dropoff_route_id)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-extrabold text-ocean-900">📅 Calendar</h1>
        <Button onClick={() => setEditing({ type: 'hike', check_in_date: date, check_out_date: date })}>
          + Schedule Dog
        </Button>
      </div>

      <div className="mb-8 flex items-center justify-center gap-4">
        <button onClick={() => setDate(addDays(date, -1))} className="text-2xl text-ocean-600">
          ‹
        </button>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" />
        <button onClick={() => setDate(addDays(date, 1))} className="text-2xl text-ocean-600">
          ›
        </button>
      </div>

      {loading && (
        <div className="flex justify-center py-10">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      {!loading && (
        <>
          {routes.map((route) => {
            const pickupList = activePickups
              .filter((e) => e.pickup_route_id === route.id)
              .sort((a, b) => (a.pickup_route_order ?? 0) - (b.pickup_route_order ?? 0))
            const dropoffList = activeDropoffs
              .filter((e) => e.dropoff_route_id === route.id)
              .sort((a, b) => (a.dropoff_route_order ?? 0) - (b.dropoff_route_order ?? 0))

            return (
              <div key={route.id} className="mb-8">
                <h2 className="mb-3 font-display text-xl font-bold text-ocean-900">Route {route.route_number}</h2>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <RouteColumn
                    title="🚗 Picking Up"
                    entries={pickupList}
                    routes={routes}
                    field="pickup"
                    onAssign={assignPickup}
                    onSetDefault={setDefaultRoute}
                    onEdit={setEditing}
                    onCancel={setCancelTarget}
                    onDelete={handleDelete}
                  />
                  <RouteColumn
                    title="🏠 Dropping Off"
                    entries={dropoffList}
                    routes={routes}
                    field="dropoff"
                    onAssign={assignDropoff}
                    onSetDefault={setDefaultRoute}
                    onEdit={setEditing}
                    onCancel={setCancelTarget}
                    onDelete={handleDelete}
                  />
                </div>
              </div>
            )
          })}

          <div className="mb-8">
            <h2 className="mb-3 font-display text-xl font-bold text-ocean-900">Unassigned</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <RouteColumn
                title="🚗 Picking Up"
                entries={unassignedPickups}
                routes={routes}
                field="pickup"
                onAssign={assignPickup}
                onSetDefault={setDefaultRoute}
                onEdit={setEditing}
                onCancel={setCancelTarget}
                onDelete={handleDelete}
              />
              <RouteColumn
                title="🏠 Dropping Off"
                entries={unassignedDropoffs}
                routes={routes}
                field="dropoff"
                onAssign={assignDropoff}
                onSetDefault={setDefaultRoute}
                onEdit={setEditing}
                onCancel={setCancelTarget}
                onDelete={handleDelete}
              />
            </div>
          </div>

          {ownerDropoffs.length > 0 && (
            <div className="mb-8">
              <h2 className="mb-3 font-display text-xl font-bold text-ocean-900">Late Pickup by Owner</h2>
              <p className="mb-3 text-sm text-ocean-700/60">No employee dropoff needed for these.</p>
              <SimpleEntryList
                entries={ownerDropoffs}
                onEdit={setEditing}
                onCancel={setCancelTarget}
                onDelete={handleDelete}
              />
            </div>
          )}

          {cancelledToday.length > 0 && (
            <div className="mb-8">
              <h2 className="mb-3 font-display text-xl font-bold text-ocean-900">Cancelled</h2>
              <SimpleEntryList entries={cancelledToday} onEdit={setEditing} onDelete={handleDelete} />
            </div>
          )}
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit Entry' : 'Schedule Dog'}>
        {editing && (
          <EntryForm
            entry={editing}
            defaultDate={date}
            onSaved={() => {
              setEditing(null)
              load()
            }}
          />
        )}
      </Modal>

      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title="Cancel this hike">
        {cancelTarget && (
          <CancelScheduleForm
            entry={cancelTarget}
            onDone={() => {
              setCancelTarget(null)
              load()
            }}
          />
        )}
      </Modal>
    </div>
  )
}

function EntryBadges({ entry }: { entry: EntryWithDog }) {
  return (
    <>
      <span
        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
          entry.type === 'boarding' ? 'bg-ocean-800 text-white' : 'bg-ocean-100 text-ocean-700'
        }`}
      >
        {entry.type === 'boarding' ? 'Boarding' : 'Daily Hike'}
      </span>
      {entry.late_pickup_by_owner && (
        <span className="ml-2 mt-1 inline-block rounded-full bg-sun-100 px-2 py-0.5 text-xs font-semibold text-sun-700">
          Late pickup by owner
        </span>
      )}
      {entry.cancelled && (
        <span className="ml-2 mt-1 inline-block rounded-full bg-sand-300 px-2 py-0.5 text-xs font-semibold text-ocean-800">
          Cancelled — {entry.cancel_reason}
          {entry.late_cancel ? ' (LATE CANCEL)' : ''}
        </span>
      )}
    </>
  )
}

function RouteColumn({
  title,
  entries,
  routes,
  field,
  onAssign,
  onSetDefault,
  onEdit,
  onCancel,
  onDelete,
}: {
  title: string
  entries: EntryWithDog[]
  routes: Route[]
  field: 'pickup' | 'dropoff'
  onAssign: (entryId: string, routeId: string) => void
  onSetDefault: (entryId: string, routeId: string) => void
  onEdit: (e: ScheduleEntry) => void
  onCancel: (e: ScheduleEntry) => void
  onDelete: (id: string) => void
}) {
  return (
    <div>
      <h3 className="mb-2 font-semibold text-ocean-800">{title}</h3>
      <div className="flex flex-col gap-3">
        {entries.map((entry) => {
          const currentRouteId = field === 'pickup' ? entry.pickup_route_id : entry.dropoff_route_id
          return (
            <Card key={entry.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display font-bold text-ocean-900">{entry.dog.name}</p>
                  <p className="text-sm text-ocean-700/70">{entry.dog.client.main_name}</p>
                  <EntryBadges entry={entry} />
                </div>
                <div className="flex flex-col items-end gap-1 text-sm">
                  <button onClick={() => onEdit(entry)} className="font-semibold text-ocean-600 hover:underline">
                    Edit
                  </button>
                  <button onClick={() => onCancel(entry)} className="font-semibold text-ocean-800 hover:underline">
                    Cancel
                  </button>
                  <button onClick={() => onDelete(entry.id)} className="font-semibold text-ocean-700 hover:underline">
                    Remove
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-sand-100 pt-3">
                <Select
                  value={currentRouteId ?? ''}
                  onChange={(e) => onAssign(entry.id, e.target.value)}
                  className="w-40"
                >
                  <option value="">Unassigned</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      Route {r.route_number}
                    </option>
                  ))}
                </Select>
                {currentRouteId && (
                  <button
                    onClick={() => onSetDefault(entry.id, currentRouteId)}
                    title="Make this route the default for this dog on this weekday"
                    className="text-xs font-semibold text-ocean-700/50 hover:text-ocean-700"
                  >
                    ☆ Set as default
                  </button>
                )}
              </div>
            </Card>
          )
        })}
        {entries.length === 0 && <p className="text-sm text-ocean-700/50">Nothing here.</p>}
      </div>
    </div>
  )
}

function SimpleEntryList({
  entries,
  onEdit,
  onCancel,
  onDelete,
}: {
  entries: EntryWithDog[]
  onEdit: (e: ScheduleEntry) => void
  onCancel?: (e: ScheduleEntry) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry) => (
        <Card key={entry.id} className={entry.cancelled ? 'bg-sand-100' : ''}>
          <div className="flex items-start justify-between">
            <div>
              <p className={`font-display font-bold text-ocean-900 ${entry.cancelled ? 'line-through' : ''}`}>
                {entry.dog.name}
              </p>
              <p className="text-sm text-ocean-700/70">{entry.dog.client.main_name}</p>
              <EntryBadges entry={entry} />
            </div>
            <div className="flex flex-col items-end gap-1 text-sm">
              <button onClick={() => onEdit(entry)} className="font-semibold text-ocean-600 hover:underline">
                Edit
              </button>
              {onCancel && !entry.cancelled && (
                <button onClick={() => onCancel(entry)} className="font-semibold text-ocean-800 hover:underline">
                  Cancel
                </button>
              )}
              <button onClick={() => onDelete(entry.id)} className="font-semibold text-ocean-700 hover:underline">
                Remove
              </button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

function EntryForm({
  entry,
  defaultDate,
  onSaved,
}: {
  entry: Partial<ScheduleEntry>
  defaultDate: string
  onSaved: () => void
}) {
  const [dogs, setDogs] = useState<Dog[] | null>(null)
  const [dogSearch, setDogSearch] = useState('')
  const [form, setForm] = useState<Partial<ScheduleEntry>>({
    scheduled_pickup_date: entry.check_in_date ?? defaultDate,
    scheduled_dropoff_date: entry.check_out_date ?? defaultDate,
    ...entry,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('dogs')
      .select('*')
      .order('name')
      .then(({ data }) => setDogs(data ?? []))
  }, [])

  function setType(type: ScheduleType) {
    setForm((f) => {
      const check_in_date = f.check_in_date ?? defaultDate
      const check_out_date = type === 'hike' ? check_in_date : f.check_out_date ?? check_in_date
      return {
        ...f,
        type,
        check_out_date,
        scheduled_pickup_date: check_in_date,
        scheduled_dropoff_date: check_out_date,
      }
    })
  }

  function setCheckIn(value: string) {
    setForm((f) => ({
      ...f,
      check_in_date: value,
      scheduled_pickup_date: value,
      check_out_date: f.type === 'hike' ? value : f.check_out_date,
      scheduled_dropoff_date: f.type === 'hike' ? value : f.scheduled_dropoff_date,
    }))
  }

  function setCheckOut(value: string) {
    setForm((f) => ({ ...f, check_out_date: value, scheduled_dropoff_date: value }))
  }

  async function handleSave() {
    if (!form.dog_id) {
      setError('Choose a dog.')
      return
    }
    setSaving(true)
    setError(null)

    const payload = {
      dog_id: form.dog_id,
      type: form.type,
      check_in_date: form.check_in_date,
      check_out_date: form.check_out_date,
      scheduled_pickup_date: form.scheduled_pickup_date,
      scheduled_pickup_time: form.scheduled_pickup_time || null,
      scheduled_dropoff_date: form.scheduled_dropoff_date,
      scheduled_dropoff_time: form.scheduled_dropoff_time || null,
      late_pickup_by_owner: form.late_pickup_by_owner ?? false,
    }

    const { error } = form.id
      ? await supabase.from('schedule_entries').update(payload as any).eq('id', form.id)
      : await supabase.from('schedule_entries').insert(payload as any)

    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    onSaved()
  }

  const filteredDogs = dogs?.filter((d) => d.name.toLowerCase().includes(dogSearch.toLowerCase()))

  return (
    <div className="flex flex-col gap-4">
      {!form.dog_id && (
        <div>
          <Input
            placeholder="Search dogs..."
            value={dogSearch}
            onChange={(e) => setDogSearch(e.target.value)}
            className="mb-2"
          />
          <div className="max-h-40 overflow-y-auto rounded-xl border border-sand-200">
            {filteredDogs?.map((dog) => (
              <button
                key={dog.id}
                onClick={() => setForm({ ...form, dog_id: dog.id })}
                className="block w-full px-3 py-2 text-left hover:bg-ocean-50"
              >
                {dog.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {form.dog_id && (
        <p className="font-display font-bold text-ocean-900">
          {dogs?.find((d) => d.id === form.dog_id)?.name}{' '}
          <button
            onClick={() => setForm({ ...form, dog_id: undefined })}
            className="text-sm font-normal text-ocean-600 hover:underline"
          >
            change
          </button>
        </p>
      )}

      <Select value={form.type ?? 'hike'} onChange={(e) => setType(e.target.value as ScheduleType)}>
        <option value="hike">Daily Hike</option>
        <option value="boarding">Boarding</option>
      </Select>

      <div className="grid grid-cols-2 gap-3">
        <Input
          type="date"
          label={form.type === 'boarding' ? 'Check-in date' : 'Hike date'}
          value={form.check_in_date ?? ''}
          onChange={(e) => setCheckIn(e.target.value)}
        />
        {form.type === 'boarding' && (
          <Input
            type="date"
            label="Check-out date"
            value={form.check_out_date ?? ''}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        )}
      </div>

      <p className="text-sm text-ocean-700/60">
        Defaults to picking up for the {form.scheduled_pickup_date} hike and dropping off after the{' '}
        {form.scheduled_dropoff_date} hike. Override below if needed.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Input
          type="date"
          label="Pickup date"
          value={form.scheduled_pickup_date ?? ''}
          onChange={(e) => setForm({ ...form, scheduled_pickup_date: e.target.value })}
        />
        <Input
          type="time"
          label="Pickup time (optional)"
          value={form.scheduled_pickup_time ?? ''}
          onChange={(e) => setForm({ ...form, scheduled_pickup_time: e.target.value })}
        />
        <Input
          type="date"
          label="Dropoff date"
          value={form.scheduled_dropoff_date ?? ''}
          onChange={(e) => setForm({ ...form, scheduled_dropoff_date: e.target.value })}
        />
        <Input
          type="time"
          label="Dropoff time (optional)"
          value={form.scheduled_dropoff_time ?? ''}
          onChange={(e) => setForm({ ...form, scheduled_dropoff_time: e.target.value })}
        />
      </div>

      <label className="flex items-center gap-2 text-sm font-semibold text-ocean-800">
        <input
          type="checkbox"
          checked={form.late_pickup_by_owner ?? false}
          onChange={(e) => setForm({ ...form, late_pickup_by_owner: e.target.checked })}
        />
        Late pickup by owner (no employee dropoff needed)
      </label>

      {error && <p className="text-sm font-semibold text-ocean-700">{error}</p>}
      <Button onClick={handleSave} disabled={saving} fullWidth>
        {saving ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Save'}
      </Button>
    </div>
  )
}
