-- Makes route setup carry forward week to week on its own: whatever admin
-- last did for a weekday (which route a dog is on, the order of each route's
-- pickups and dropoffs, who drives each route) is what the next occurrence of
-- that weekday starts from, until admin changes it. Previously each of those
-- needed an explicit "Set default" click, and nothing was slotted at all on a
-- future day until admin had created that day's routes by hand.

-- Pickup and dropoff now remember their route separately, so moving only a
-- dog's dropoff doesn't drag their pickup along with it next week.
alter table dog_weekly_pattern add column default_dropoff_route_number int
  check (default_dropoff_route_number between 1 and 3);
update dog_weekly_pattern set default_dropoff_route_number = default_route_number;

-- The Weekly Schedule page's per-day route picker sets both legs at once.
create or replace function set_default_route(p_dog_id uuid, p_day_of_week int, p_route_number int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only admin can set default routes';
  end if;

  insert into dog_weekly_pattern (dog_id, day_of_week, default_route_number, default_dropoff_route_number)
  values (p_dog_id, p_day_of_week, p_route_number, p_route_number)
  on conflict (dog_id, day_of_week)
  do update set default_route_number = excluded.default_route_number,
                default_dropoff_route_number = excluded.default_dropoff_route_number,
                default_pickup_order = null,
                default_dropoff_order = null;
end;
$$;

-- Saves a route's current pickup (or dropoff) list -- which dogs are on it and
-- in what order -- as the default for that weekday. Called automatically
-- after every assign, move, remove or reorder on the Routes/Calendar pages.
-- Only updates dogs that already hike on this weekday every week; a one-off
-- add stays a one-off.
create function save_route_as_default(p_route_id uuid, p_field text)
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
end;
$$;

-- Forgets a dog's default pickup (or dropoff) route for a weekday, for when
-- admin takes them off a route entirely.
create function clear_default_route(p_dog_id uuid, p_day_of_week int, p_field text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only admin can set default routes';
  end if;

  if p_field = 'pickup' then
    update dog_weekly_pattern set default_route_number = null, default_pickup_order = null
    where dog_id = p_dog_id and day_of_week = p_day_of_week;
  elsif p_field = 'dropoff' then
    update dog_weekly_pattern set default_dropoff_route_number = null, default_dropoff_order = null
    where dog_id = p_dog_id and day_of_week = p_day_of_week;
  else
    raise exception 'p_field must be pickup or dropoff';
  end if;
end;
$$;

-- Now also (1) creates a today-or-later day's routes when they don't exist
-- yet, copying route numbers and drivers from the most recent earlier
-- occurrence of the same weekday, and (2) uses the separate dropoff default.
-- Any signed-in staff can call it (it only ever applies admin's saved
-- defaults and fills in blanks), so an employee opening the app gets today's
-- route even if admin never opened that day.
create or replace function apply_default_routes_for_date(p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dow int := extract(dow from p_date);
  v_prev_date date;
  v_entry record;
  v_route_id uuid;
  v_next_order int;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Not signed in';
  end if;

  -- A day of slack so an evening in US time (already tomorrow in UTC) still counts as today.
  if p_date >= current_date - 1 then
    select max(r.date) into v_prev_date
    from routes r
    where r.date < p_date and extract(dow from r.date) = v_dow;

    if v_prev_date is not null then
      insert into routes (date, route_number, employee_id)
      select p_date, prev.route_number, prev.employee_id
      from routes prev
      where prev.date = v_prev_date
      on conflict (date, route_number) do nothing;
    end if;
  end if;

  for v_entry in
    select se.id, dwp.default_route_number as route_number, dwp.default_pickup_order as default_order
    from schedule_entries se
    join dog_weekly_pattern dwp on dwp.dog_id = se.dog_id and dwp.day_of_week = v_dow
    where se.type = 'hike'
      and se.check_in_date = p_date
      and se.cancelled = false
      and se.pickup_route_id is null
      and dwp.default_route_number is not null
    order by dwp.default_pickup_order nulls last, se.created_at
  loop
    v_route_id := null;
    select id into v_route_id from routes where date = p_date and route_number = v_entry.route_number;
    if v_route_id is not null then
      if v_entry.default_order is not null then
        v_next_order := v_entry.default_order;
      else
        select coalesce(max(pickup_route_order) + 1, 0) into v_next_order
        from schedule_entries where pickup_route_id = v_route_id;
      end if;
      update schedule_entries set pickup_route_id = v_route_id, pickup_route_order = v_next_order
      where id = v_entry.id;
    end if;
  end loop;

  for v_entry in
    select se.id, dwp.default_dropoff_route_number as route_number, dwp.default_dropoff_order as default_order
    from schedule_entries se
    join dog_weekly_pattern dwp on dwp.dog_id = se.dog_id and dwp.day_of_week = v_dow
    where se.type = 'hike'
      and se.check_out_date = p_date
      and se.cancelled = false
      and se.late_pickup_by_owner = false
      and se.dropoff_route_id is null
      and dwp.default_dropoff_route_number is not null
    order by dwp.default_dropoff_order nulls last, se.created_at
  loop
    v_route_id := null;
    select id into v_route_id from routes where date = p_date and route_number = v_entry.route_number;
    if v_route_id is not null then
      if v_entry.default_order is not null then
        v_next_order := v_entry.default_order;
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

-- Fills in one day's recurring hikes from the weekly pattern and applies the
-- saved route defaults, for any signed-in staff. Lets the employee pages set
-- up today and the coming week without waiting on admin to open those days.
create function prepare_day(p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Not signed in';
  end if;

  insert into schedule_entries (
    dog_id, type, check_in_date, check_out_date, scheduled_pickup_date, scheduled_dropoff_date
  )
  select dwp.dog_id, 'hike', p_date, p_date, p_date, p_date
  from dog_weekly_pattern dwp
  where dwp.day_of_week = extract(dow from p_date)
    and not exists (
      select 1 from schedule_entries se
      where se.dog_id = dwp.dog_id and se.type = 'hike' and se.check_in_date = p_date
    );

  perform apply_default_routes_for_date(p_date);
end;
$$;

grant execute on function save_route_as_default(uuid, text) to authenticated;
grant execute on function clear_default_route(uuid, int, text) to authenticated;
grant execute on function prepare_day(date) to authenticated;

-- Replaced by save_route_as_default, which runs automatically.
drop function set_default_pickup_order(uuid[], int, int);
drop function set_default_dropoff_order(uuid[], int, int);
