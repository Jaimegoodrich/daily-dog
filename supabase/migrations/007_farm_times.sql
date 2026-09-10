-- Tracks when a route's van arrives at and leaves the farm (once per route,
-- not per dog), shown between Pickups and Dropoffs on the employee route page.
alter table routes add column arrived_at_farm_at timestamptz;
alter table routes add column left_farm_at timestamptz;

create function log_farm_arrival(p_route_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update routes set arrived_at_farm_at = now() where id = p_route_id and employee_id = current_employee_id();
  if not found then
    raise exception 'Route not found or not yours';
  end if;
end;
$$;

create function log_farm_departure(p_route_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update routes set left_farm_at = now() where id = p_route_id and employee_id = current_employee_id();
  if not found then
    raise exception 'Route not found or not yours';
  end if;
end;
$$;

grant execute on function log_farm_arrival(uuid) to authenticated;
grant execute on function log_farm_departure(uuid) to authenticated;
