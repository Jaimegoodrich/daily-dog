import type { ScheduleEntry } from '@/types/database'

type Ordered = Pick<
  ScheduleEntry,
  'pickup_route_order' | 'dropoff_route_order' | 'pickup_at_jaimes' | 'dropoff_at_jaimes'
>

// Dogs at Jaime's override the saved route order: they're picked up first
// (the route starts from the house) and dropped off last (it ends there).

export function comparePickups(a: Ordered, b: Ordered) {
  return Number(b.pickup_at_jaimes) - Number(a.pickup_at_jaimes) || (a.pickup_route_order ?? 0) - (b.pickup_route_order ?? 0)
}

export function compareDropoffs(a: Ordered, b: Ordered) {
  return (
    Number(a.dropoff_at_jaimes) - Number(b.dropoff_at_jaimes) || (a.dropoff_route_order ?? 0) - (b.dropoff_route_order ?? 0)
  )
}
