-- Extends the per-weekday default route with an optional default *position*
-- within that route, separately for pickup and dropoff, so a carefully
-- arranged route order persists week over week instead of resetting to
-- append-at-the-end every time a new day's routes are created.
alter table dog_weekly_pattern add column default_pickup_order int;
alter table dog_weekly_pattern add column default_dropoff_order int;

-- Saves the current order of an entire route's pickup list as the default
-- for every future occurrence of this weekday. Takes the dog ids in their
-- new display order and assigns them 0, 1, 2... as the default position,
-- alongside the route number they're on.
create function set_default_pickup_order(p_dog_ids uuid[], p_day_of_week int, p_route_number int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dog_id uuid;
  v_order int := 0;
begin
  if not is_admin() then
    raise exception 'Only admin can set default routes';
  end if;

  foreach v_dog_id in array p_dog_ids loop
    insert into dog_weekly_pattern (dog_id, day_of_week, default_route_number, default_pickup_order)
    values (v_dog_id, p_day_of_week, p_route_number, v_order)
    on conflict (dog_id, day_of_week)
    do update set default_route_number = excluded.default_route_number,
                  default_pickup_order = excluded.default_pickup_order;
    v_order := v_order + 1;
  end loop;
end;
$$;

grant execute on function set_default_pickup_order(uuid[], int, int) to authenticated;

-- Same as set_default_pickup_order, for the dropoff list.
create function set_default_dropoff_order(p_dog_ids uuid[], p_day_of_week int, p_route_number int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dog_id uuid;
  v_order int := 0;
begin
  if not is_admin() then
    raise exception 'Only admin can set default routes';
  end if;

  foreach v_dog_id in array p_dog_ids loop
    insert into dog_weekly_pattern (dog_id, day_of_week, default_route_number, default_dropoff_order)
    values (v_dog_id, p_day_of_week, p_route_number, v_order)
    on conflict (dog_id, day_of_week)
    do update set default_route_number = excluded.default_route_number,
                  default_dropoff_order = excluded.default_dropoff_order;
    v_order := v_order + 1;
  end loop;
end;
$$;

grant execute on function set_default_dropoff_order(uuid[], int, int) to authenticated;

-- Replaces apply_default_routes_for_date to honor a stored default order
-- when auto-slotting a dog onto their default route, falling back to
-- appending at the end when no default order has been saved for that dog
-- yet (unchanged behavior otherwise: only ever fills in nulls, never
-- overrides a manual assignment).
create or replace function apply_default_routes_for_date(p_date date)
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
    select se.id, dwp.default_route_number, dwp.default_pickup_order
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
      if v_entry.default_pickup_order is not null then
        v_next_order := v_entry.default_pickup_order;
      else
        select coalesce(max(pickup_route_order) + 1, 0) into v_next_order
        from schedule_entries where pickup_route_id = v_route_id;
      end if;
      update schedule_entries set pickup_route_id = v_route_id, pickup_route_order = v_next_order
      where id = v_entry.id;
    end if;
  end loop;

  for v_entry in
    select se.id, dwp.default_route_number, dwp.default_dropoff_order
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
      if v_entry.default_dropoff_order is not null then
        v_next_order := v_entry.default_dropoff_order;
      else
        select coalesce(max(dropoff_route_order) + 1, 0) into v_next_order
        from schedule_entries where dropoff_route_id = v_route_id;
      end if;
      update schedule_entries set dropoff_route_id = v_route_id, dropoff_route_order = v_next_order
      where id = v_entry.id;
    end if;
  end loop;
end;
$$;
