-- Route changes now reach later weeks that are already set up. The employee
-- Schedule page builds the coming 7 days ahead of time, so next week's
-- matching weekday usually already had its routes and dogs placed before
-- admin changed this week -- and setup only ever fills in blanks, so those
-- days kept the old drivers and dog order.
--
-- Now, after admin changes a day, every later occurrence of that weekday that
-- has already been set up (and whose route hasn't started) is brought in line:
--   * drivers: a later route still showing the old driver gets the new one
--   * dogs: regular dogs on that weekday are re-placed from the saved
--     defaults; one-off adds keep wherever they were put

-- Re-places regular dogs' pickups (or dropoffs) on already-set-up occurrences
-- of p_date's weekday after p_date. Internal: callers check permissions.
create function carry_routes_forward(p_date date, p_field text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dow int := extract(dow from p_date);
  v_date date;
begin
  for v_date in
    select distinct date from routes
    where date > p_date and date >= current_date - 1 and extract(dow from date) = v_dow
  loop
    if p_field = 'pickup' then
      update schedule_entries se
      set pickup_route_id = null, pickup_route_order = null
      from routes r, dog_weekly_pattern dwp
      where se.pickup_route_id = r.id and r.date = v_date and r.status = 'pending'
        and se.type = 'hike' and se.pickup_status = 'pending'
        and dwp.dog_id = se.dog_id and dwp.day_of_week = v_dow;
    else
      update schedule_entries se
      set dropoff_route_id = null, dropoff_route_order = null
      from routes r, dog_weekly_pattern dwp
      where se.dropoff_route_id = r.id and r.date = v_date and r.status = 'pending'
        and se.type = 'hike' and se.dropoff_status = 'pending'
        and dwp.dog_id = se.dog_id and dwp.day_of_week = v_dow;
    end if;
    perform apply_default_routes_for_date(v_date);
  end loop;
end;
$$;

revoke execute on function carry_routes_forward(date, text) from public, anon, authenticated;

-- Same as before, plus carrying the change to later weeks already set up.
create or replace function save_route_as_default(p_route_id uuid, p_field text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route routes%rowtype;
  v_dow int;
begin
  if not is_admin() then
    raise exception 'Only admin can set default routes';
  end if;

  select * into v_route from routes where id = p_route_id;
  if not found then
    raise exception 'Route not found';
  end if;
  v_dow := extract(dow from v_route.date);

  if p_field = 'pickup' then
    update dog_weekly_pattern dwp
    set default_route_number = v_route.route_number,
        default_pickup_order = ranked.pos
    from (
      select dog_id, (row_number() over (order by pickup_route_order, created_at) - 1)::int as pos
      from schedule_entries
      where pickup_route_id = p_route_id and cancelled = false
    ) ranked
    where dwp.dog_id = ranked.dog_id and dwp.day_of_week = v_dow;
  elsif p_field = 'dropoff' then
    update dog_weekly_pattern dwp
    set default_dropoff_route_number = v_route.route_number,
        default_dropoff_order = ranked.pos
    from (
      select dog_id, (row_number() over (order by dropoff_route_order, created_at) - 1)::int as pos
      from schedule_entries
      where dropoff_route_id = p_route_id and cancelled = false
    ) ranked
    where dwp.dog_id = ranked.dog_id and dwp.day_of_week = v_dow;
  else
    raise exception 'p_field must be pickup or dropoff';
  end if;

  perform carry_routes_forward(v_route.date, p_field);
end;
$$;

-- Sets who drives a route on a day (creating the route if needed), and passes
-- the change on to later occurrences of that weekday already set up that
-- still have the old driver. A later week deliberately given someone else
-- keeps them.
create function set_route_employee(p_date date, p_route_number int, p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_employee_id uuid;
  v_existed boolean;
  v_date date;
begin
  if not is_admin() then
    raise exception 'Only admin can assign routes';
  end if;

  select employee_id into v_old_employee_id from routes where date = p_date and route_number = p_route_number;
  v_existed := found;

  if v_existed then
    update routes set employee_id = p_employee_id where date = p_date and route_number = p_route_number;
  elsif p_employee_id is not null then
    insert into routes (date, route_number, employee_id) values (p_date, p_route_number, p_employee_id);
  else
    return;
  end if;

  for v_date in
    select distinct date from routes
    where date > p_date and date >= current_date - 1 and extract(dow from date) = extract(dow from p_date)
  loop
    update routes set employee_id = p_employee_id
    where date = v_date and route_number = p_route_number and status = 'pending'
      and employee_id is not distinct from v_old_employee_id;
    -- A route that didn't exist when that day was set up gets added, and its
    -- regular dogs slotted onto it.
    if not v_existed and p_employee_id is not null then
      insert into routes (date, route_number, employee_id) values (v_date, p_route_number, p_employee_id)
      on conflict (date, route_number) do nothing;
      perform apply_default_routes_for_date(v_date);
    end if;
  end loop;
end;
$$;

grant execute on function set_route_employee(date, int, uuid) to authenticated;
