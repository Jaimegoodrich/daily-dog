-- Remembers which route a dog was assigned to on a given weekday, and
-- auto-assigns them to that same route number on future occurrences of that
-- weekday (as soon as a route with that number exists for the date) so admin
-- doesn't have to re-place dogs onto routes every day.
alter table dog_weekly_pattern add column default_route_number int
  check (default_route_number between 1 and 3);

-- Called by the client whenever admin assigns a dog's pickup or dropoff to a
-- route, to remember that route number as the default for this weekday.
create function set_default_route(p_dog_id uuid, p_day_of_week int, p_route_number int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only admin can set default routes';
  end if;

  insert into dog_weekly_pattern (dog_id, day_of_week, default_route_number)
  values (p_dog_id, p_day_of_week, p_route_number)
  on conflict (dog_id, day_of_week)
  do update set default_route_number = excluded.default_route_number;
end;
$$;

grant execute on function set_default_route(uuid, int, int) to authenticated;

-- Fills in pickup_route_id/dropoff_route_id for any of the date's hike
-- entries that are missing one, using each dog's default route number for
-- that weekday, if a route with that number already exists for the date.
-- Safe to call repeatedly (only ever fills in nulls, never overrides a
-- manual assignment).
create function apply_default_routes_for_date(p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dow int := extract(dow from p_date);
  v_entry record;
  v_route_id uuid;
  v_next_order int;
begin
  if not is_admin() then
    raise exception 'Only admin can apply default routes';
  end if;

  for v_entry in
    select se.id, dwp.default_route_number
    from schedule_entries se
    join dog_weekly_pattern dwp on dwp.dog_id = se.dog_id and dwp.day_of_week = v_dow
    where se.type = 'hike'
      and se.check_in_date = p_date
      and se.cancelled = false
      and se.pickup_route_id is null
      and dwp.default_route_number is not null
    order by se.created_at
  loop
    select id into v_route_id from routes where date = p_date and route_number = v_entry.default_route_number;
    if v_route_id is not null then
      select coalesce(max(pickup_route_order) + 1, 0) into v_next_order
      from schedule_entries where pickup_route_id = v_route_id;
      update schedule_entries set pickup_route_id = v_route_id, pickup_route_order = v_next_order
      where id = v_entry.id;
    end if;
  end loop;

  for v_entry in
    select se.id, dwp.default_route_number
    from schedule_entries se
    join dog_weekly_pattern dwp on dwp.dog_id = se.dog_id and dwp.day_of_week = v_dow
    where se.type = 'hike'
      and se.check_out_date = p_date
      and se.cancelled = false
      and se.late_pickup_by_owner = false
      and se.dropoff_route_id is null
      and dwp.default_route_number is not null
    order by se.created_at
  loop
    select id into v_route_id from routes where date = p_date and route_number = v_entry.default_route_number;
    if v_route_id is not null then
      select coalesce(max(dropoff_route_order) + 1, 0) into v_next_order
      from schedule_entries where dropoff_route_id = v_route_id;
      update schedule_entries set dropoff_route_id = v_route_id, dropoff_route_order = v_next_order
      where id = v_entry.id;
    end if;
  end loop;
end;
$$;

grant execute on function apply_default_routes_for_date(date) to authenticated;
