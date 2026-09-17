import { useState } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card } from '@/components/ui/Card'
import { Select, Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { useRoutesForDay, type EntryWithDog } from '@/hooks/useRoutesForDay'
import type { Route } from '@/types/database'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export function AdminRoutes() {
  const [date, setDate] = useState(todayStr())
  const { routes, entries, employees, loading, setRouteEmployee, setDefaultRoute, assignPickup, assignDropoff, reorder } =
    useRoutesForDay(date)

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  const activeEntries = entries.filter((e) => !e.cancelled)
  const unassignedPickups = activeEntries.filter((e) => e.scheduled_pickup_date === date && !e.pickup_route_id)
  const unassignedDropoffs = activeEntries.filter(
    (e) => e.scheduled_dropoff_date === date && !e.dropoff_route_id && !e.late_pickup_by_owner
  )

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-extrabold text-ocean-900">🗺️ Routes</h1>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((num) => {
          const route = routes.find((r) => r.route_number === num)
          return (
            <Card key={num}>
              <p className="mb-2 font-display font-bold text-ocean-900">Route {num}</p>
              <Select
                value={route?.employee_id ?? ''}
                onChange={(e) => setRouteEmployee(num, e.target.value)}
              >
                <option value="">Unassigned</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.display_name}
                  </option>
                ))}
              </Select>
              {route && <p className="mt-2 text-xs font-semibold text-ocean-700/60">{route.status}</p>}
            </Card>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-3 font-display text-lg font-bold text-ocean-800">Unassigned Pickups</h2>
          <div className="flex flex-col gap-2">
            {unassignedPickups.map((entry) => (
              <UnassignedRow key={entry.id} entry={entry} routes={routes} onAssign={(rid) => assignPickup(entry.id, rid)} />
            ))}
            {unassignedPickups.length === 0 && <p className="text-sm text-ocean-700/50">All assigned.</p>}
          </div>
        </div>
        <div>
          <h2 className="mb-3 font-display text-lg font-bold text-ocean-800">Unassigned Dropoffs</h2>
          <div className="flex flex-col gap-2">
            {unassignedDropoffs.map((entry) => (
              <UnassignedRow key={entry.id} entry={entry} routes={routes} onAssign={(rid) => assignDropoff(entry.id, rid)} />
            ))}
            {unassignedDropoffs.length === 0 && <p className="text-sm text-ocean-700/50">All assigned.</p>}
          </div>
        </div>
      </div>

      {routes.map((route) => {
        const pickupList = activeEntries
          .filter((e) => e.pickup_route_id === route.id)
          .sort((a, b) => (a.pickup_route_order ?? 0) - (b.pickup_route_order ?? 0))
        const dropoffList = activeEntries
          .filter((e) => e.dropoff_route_id === route.id)
          .sort((a, b) => (a.dropoff_route_order ?? 0) - (b.dropoff_route_order ?? 0))

        return (
          <div key={route.id} className="mt-8">
            <h2 className="mb-3 font-display text-xl font-bold text-ocean-900">Route {route.route_number} Order</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <OrderedList
                title="Pickups"
                list={pickupList}
                onReorder={(from, to) => reorder(pickupList, 'pickup_route_order', from, to)}
                onRemove={(id) => assignPickup(id, '')}
                onSetDefault={(id) => setDefaultRoute(id, route.id)}
              />
              <OrderedList
                title="Dropoffs"
                list={dropoffList}
                onReorder={(from, to) => reorder(dropoffList, 'dropoff_route_order', from, to)}
                onRemove={(id) => assignDropoff(id, '')}
                onSetDefault={(id) => setDefaultRoute(id, route.id)}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function UnassignedRow({
  entry,
  routes,
  onAssign,
}: {
  entry: EntryWithDog
  routes: Route[]
  onAssign: (routeId: string) => void
}) {
  return (
    <Card className="flex items-center justify-between">
      <div>
        <p className="font-semibold text-ocean-900">{entry.dog.name}</p>
        <p className="text-xs text-ocean-700/60">{entry.dog.client.main_name}</p>
      </div>
      <Select defaultValue="" onChange={(e) => e.target.value && onAssign(e.target.value)} className="w-40">
        <option value="">Assign to...</option>
        {routes.map((r) => (
          <option key={r.id} value={r.id}>
            Route {r.route_number}
          </option>
        ))}
      </Select>
    </Card>
  )
}

function OrderedList({
  title,
  list,
  onReorder,
  onRemove,
  onSetDefault,
}: {
  title: string
  list: EntryWithDog[]
  onReorder: (fromIndex: number, toIndex: number) => void
  onRemove: (id: string) => void
  onSetDefault: (id: string) => void
}) {
  // A small activation distance keeps an ordinary tap from being mistaken
  // for a drag, on both mouse and touch.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIndex = list.findIndex((e) => e.id === active.id)
    const toIndex = list.findIndex((e) => e.id === over.id)
    if (fromIndex === -1 || toIndex === -1) return
    onReorder(fromIndex, toIndex)
  }

  return (
    <div>
      <p className="mb-2 font-semibold text-ocean-800">{title}</p>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={list.map((e) => e.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {list.map((entry, i) => (
              <SortableRow
                key={entry.id}
                entry={entry}
                index={i}
                onRemove={onRemove}
                onSetDefault={onSetDefault}
              />
            ))}
            {list.length === 0 && <p className="text-sm text-ocean-700/50">None assigned.</p>}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function SortableRow({
  entry,
  index,
  onRemove,
  onSetDefault,
}: {
  entry: EntryWithDog
  index: number
  onRemove: (id: string) => void
  onSetDefault: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id })

  return (
    <Card
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center justify-between py-2 ${isDragging ? 'relative z-10 shadow-lg' : ''}`}
    >
      <p
        {...attributes}
        {...listeners}
        className="flex flex-1 cursor-grab items-center gap-2 self-stretch py-2 font-semibold text-ocean-900 active:cursor-grabbing"
        style={{ touchAction: 'none' }}
      >
        <span className="text-xl text-ocean-700/40" aria-hidden>
          ⠿
        </span>
        {index + 1}. {entry.dog.name}
      </p>
      <div className="flex items-center gap-3 text-sm">
        <button
          onClick={() => onSetDefault(entry.id)}
          title="Make this route the default for this dog on this weekday"
          className="text-ocean-700/50 hover:text-ocean-700"
        >
          ☆ Set default
        </button>
        <button onClick={() => onRemove(entry.id)} className="text-ocean-700">
          ✕
        </button>
      </div>
    </Card>
  )
}
