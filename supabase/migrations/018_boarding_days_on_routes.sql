-- Every day of a boarding stay is now a real hike on the routes, with
-- Jaime's house at one or both ends:
--   check-in day:  pick up at the owner's house -> drop at Jaime's
--   middle days:   pick up at Jaime's           -> drop at Jaime's
--   check-out day: pick up at Jaime's           -> drop at the owner's house
-- Previously the check-in pickup and check-out dropoff rode on the stay row
-- itself, and the drop at / pickup from Jaime's on those days was only a
-- reminder card, not something on the route. The stay row is now just the
-- booking (dates, belongings, after-hours transports) and never goes on a
-- route.
--
-- An After Hours pickup means the dog arrives that evening instead, so the
-- check-in day has no stay hike; an After Hours dropoff means the dog goes
-- home that evening, so the check-out day hike ends back at Jaime's.

-- Undoes a stay's hikes for days not yet picked up: a usual hike day goes back
-- to the owner's address, an extra day is removed. Also restores regular hikes
-- that older bookings cancelled with reason 'boarding'. Internal: callers
-- check permissions.
create function clear_boarding_hikes(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stay schedule_entries%rowtype;
begin
  select * into v_stay from schedule_entries where id = p_entry_id and type = 'boarding';
  if not found then
    return;
  end if;

  update schedule_entries
  set cancelled = false, cancel_reason = null, updated_at = now()
  where dog_id = v_stay.dog_id and type = 'hike'
    and check_in_date in (v_stay.check_in_date, v_stay.check_out_date)
    and cancelled = true and cancel_reason = 'boarding';

  update schedule_entries se
  set pickup_at_jaimes = false, dropoff_at_jaimes = false, boarding_entry_id = null, updated_at = now()
  where se.boarding_entry_id = p_entry_id
    and se.pickup_status = 'pending'
    and exists (
      select 1 from dog_weekly_pattern dwp
      where dwp.dog_id = se.dog_id and dwp.day_of_week = extract(dow from se.check_in_date)
    );

  delete from schedule_entries
  where boarding_entry_id = p_entry_id and pickup_status = 'pending';
end;
$$;

-- Gives each day of an active stay its hike, per the table at the top. Uses
-- the dog's regular hike that day if there is one (unless it's cancelled for
-- another reason, e.g. vet), otherwise adds one. Internal.
create function build_boarding_hikes(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stay schedule_entries%rowtype;
  v_day date;
  v_pickup_jaimes boolean;
  v_dropoff_jaimes boolean;
begin
  select * into v_stay from schedule_entries where id = p_entry_id and type = 'boarding' and cancelled = false;
  if not found then
    return;
  end if;

  v_day := v_stay.check_in_date;
  while v_day <= v_stay.check_out_date loop
    v_pickup_jaimes := v_day > v_stay.check_in_date;
    v_dropoff_jaimes := v_day < v_stay.check_out_date or v_stay.after_hours_dropoff;

    if not (v_day = v_stay.check_in_date and v_stay.after_hours_pickup) then
      update schedule_entries
      set pickup_at_jaimes = v_pickup_jaimes, dropoff_at_jaimes = v_dropoff_jaimes,
          boarding_entry_id = p_entry_id, updated_at = now()
      where dog_id = v_stay.dog_id and type = 'hike' and check_in_date = v_day and cancelled = false;

      insert into schedule_entries (
        dog_id, type, check_in_date, check_out_date, scheduled_pickup_date, scheduled_dropoff_date,
        pickup_at_jaimes, dropoff_at_jaimes, boarding_entry_id
      )
      select v_stay.dog_id, 'hike', v_day, v_day, v_day, v_day, v_pickup_jaimes, v_dropoff_jaimes, p_entry_id
      where not exists (
        select 1 from schedule_entries se
        where se.dog_id = v_stay.dog_id and se.type = 'hike' and se.check_in_date = v_day
      );
    end if;

    v_day := v_day + 1;
  end loop;
end;
$$;

revoke execute on function clear_boarding_hikes(uuid) from public, anon, authenticated;
revoke execute on function build_boarding_hikes(uuid) from public, anon, authenticated;

create or replace function book_boarding(p_dog_id uuid, p_check_in date, p_check_out date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not is_admin() then
    raise exception 'Only admin can manage boarding';
  end if;
  if p_check_out <= p_check_in then
    raise exception 'Check-out must be after check-in';
  end if;

  insert into schedule_entries (
    dog_id, type, check_in_date, check_out_date, scheduled_pickup_date, scheduled_dropoff_date
  )
  values (p_dog_id, 'boarding', p_check_in, p_check_out, p_check_in, p_check_out)
  returning id into v_id;

  perform build_boarding_hikes(v_id);
  return v_id;
end;
$$;

create or replace function change_boarding_dates(p_entry_id uuid, p_check_in date, p_check_out date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry schedule_entries%rowtype;
begin
  if not is_admin() then
    raise exception 'Only admin can manage boarding';
  end if;
  if p_check_out <= p_check_in then
    raise exception 'Check-out must be after check-in';
  end if;

  select * into v_entry from schedule_entries where id = p_entry_id and type = 'boarding';
  if not found then
    raise exception 'Boarding not found';
  end if;

  perform clear_boarding_hikes(p_entry_id);

  update schedule_entries
  set check_in_date = p_check_in,
      check_out_date = p_check_out,
      scheduled_pickup_date = p_check_in,
      scheduled_dropoff_date = p_check_out,
      updated_at = now()
  where id = p_entry_id;

  -- After-hours legs that were on the old check-in/out day follow it.
  update after_hours_transports set date = p_check_in
  where schedule_entry_id = p_entry_id and kind = 'pickup' and date = v_entry.check_in_date;
  update after_hours_transports set date = p_check_out
  where schedule_entry_id = p_entry_id and kind = 'dropoff' and date = v_entry.check_out_date;

  perform build_boarding_hikes(p_entry_id);
end;
$$;

create or replace function cancel_boarding(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only admin can manage boarding';
  end if;

  perform 1 from schedule_entries where id = p_entry_id and type = 'boarding';
  if not found then
    raise exception 'Boarding not found';
  end if;

  perform clear_boarding_hikes(p_entry_id);
  delete from after_hours_transports where schedule_entry_id = p_entry_id;
  update schedule_entries
  set cancelled = true, cancel_reason = 'other',
      after_hours_pickup = false, after_hours_dropoff = false,
      updated_at = now()
  where id = p_entry_id;
end;
$$;

create or replace function set_after_hours_transport(
  p_entry_id uuid, p_kind text, p_date date, p_time time, p_employee_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only admin can manage boarding';
  end if;
  if p_kind not in ('pickup', 'dropoff') then
    raise exception 'p_kind must be pickup or dropoff';
  end if;

  insert into after_hours_transports (schedule_entry_id, kind, date, time, employee_id)
  values (p_entry_id, p_kind, p_date, p_time, p_employee_id)
  on conflict (schedule_entry_id, kind)
  do update set date = excluded.date, time = excluded.time, employee_id = excluded.employee_id;

  perform clear_boarding_hikes(p_entry_id);
  if p_kind = 'pickup' then
    update schedule_entries set after_hours_pickup = true, updated_at = now() where id = p_entry_id;
  else
    update schedule_entries set after_hours_dropoff = true, updated_at = now() where id = p_entry_id;
  end if;
  perform build_boarding_hikes(p_entry_id);
end;
$$;

create or replace function remove_after_hours_transport(p_entry_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only admin can manage boarding';
  end if;

  delete from after_hours_transports where schedule_entry_id = p_entry_id and kind = p_kind;
  perform clear_boarding_hikes(p_entry_id);
  if p_kind = 'pickup' then
    update schedule_entries set after_hours_pickup = false, updated_at = now() where id = p_entry_id;
  elsif p_kind = 'dropoff' then
    update schedule_entries set after_hours_dropoff = false, updated_at = now() where id = p_entry_id;
  end if;
  perform build_boarding_hikes(p_entry_id);
end;
$$;

-- Picking up a boarding dog on check-in day marks the stay picked up and
-- saves the belongings on the stay, so they show again at check-out.
create or replace function log_pickup(p_schedule_entry_id uuid, p_note text default null, p_belongings text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stay_id uuid;
  v_day date;
begin
  update schedule_entries se
  set pickup_status = 'picked_up',
      actual_pickup_at = now(),
      pickup_issue_notes = p_note,
      belongings_notes = coalesce(p_belongings, se.belongings_notes),
      updated_at = now()
  from routes r
  where se.id = p_schedule_entry_id
    and se.pickup_route_id = r.id
    and r.employee_id = current_employee_id()
    and r.status = 'in_progress'
    and r.clocked_out_at is null
  returning se.boarding_entry_id, se.check_in_date into v_stay_id, v_day;

  if not found then
    raise exception 'Schedule entry not found, not on your route, or you are not clocked in';
  end if;

  if v_stay_id is not null then
    update schedule_entries
    set pickup_status = 'picked_up', actual_pickup_at = now(),
        belongings_notes = coalesce(p_belongings, belongings_notes), updated_at = now()
    where id = v_stay_id and check_in_date = v_day;
  end if;
end;
$$;

-- Dropping a boarding dog home on check-out day marks the stay dropped off.
create or replace function log_dropoff(p_schedule_entry_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stay_id uuid;
  v_day date;
begin
  update schedule_entries se
  set dropoff_status = 'dropped_off',
      actual_dropoff_at = now(),
      dropoff_issue_notes = p_note,
      updated_at = now()
  from routes r
  where se.id = p_schedule_entry_id
    and se.dropoff_route_id = r.id
    and r.employee_id = current_employee_id()
    and r.status = 'in_progress'
    and r.clocked_out_at is null
  returning se.boarding_entry_id, se.check_in_date into v_stay_id, v_day;

  if not found then
    raise exception 'Schedule entry not found, not on your route, or you are not clocked in';
  end if;

  if v_stay_id is not null then
    update schedule_entries
    set dropoff_status = 'dropped_off', actual_dropoff_at = now(), updated_at = now()
    where id = v_stay_id and check_out_date = v_day and after_hours_dropoff = false;
  end if;
end;
$$;

-- Only hikes go on routes now (back to how it was before 016).
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

-- Replaced by clear_boarding_hikes / build_boarding_hikes.
drop function if exists set_boarding_stay_hikes(uuid, boolean);
drop function if exists set_boarding_hikes(uuid, date[], boolean);

-- Convert stays already booked: take the stay row off any route it was on,
-- then rebuild its days with the new rules. Only days not yet picked up are
-- touched.
do $$
declare
  v_stay record;
begin
  for v_stay in
    select id from schedule_entries
    where type = 'boarding' and cancelled = false and check_out_date >= current_date
  loop
    update schedule_entries
    set pickup_route_id = null, pickup_route_order = null,
        dropoff_route_id = null, dropoff_route_order = null
    where id = v_stay.id;
    perform clear_boarding_hikes(v_stay.id);
    perform build_boarding_hikes(v_stay.id);
  end loop;
end;
$$;
