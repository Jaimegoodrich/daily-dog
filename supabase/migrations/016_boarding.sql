-- Boarding at the admin's house, managed from its own Admin > Boarding tab.
--
-- Default flow: the dog is picked up on the check-in day as part of that
-- day's hike, goes to the house after the hike, boards however many nights,
-- and is dropped off after the hike on the check-out day. Either leg can
-- instead be an After Hours Transport: a timed pickup or dropoff assigned to
-- one employee on a specific day, which takes that leg off the hike routes.

-- What came with the dog (belongings, food, medication), logged by the
-- employee at pickup and shown again at dropoff so it all goes home.
alter table schedule_entries add column belongings_notes text;

-- True when that leg happens as an After Hours Transport instead of on a
-- hike route; kept in sync by set/remove_after_hours_transport.
alter table schedule_entries add column after_hours_pickup boolean not null default false;
alter table schedule_entries add column after_hours_dropoff boolean not null default false;

-- 'boarding' marks a regular hike that's covered by a boarding stay's own
-- pickup/dropoff (so the dog isn't collected twice). Restored automatically
-- if the stay moves or is cancelled.
alter table schedule_entries drop constraint schedule_entries_cancel_reason_check;
alter table schedule_entries add constraint schedule_entries_cancel_reason_check
  check (cancel_reason in ('vet', 'grooming', 'vacation', 'injury', 'rain', 'heat', 'admin', 'boarding', 'other'));

create table after_hours_transports (
  id uuid primary key default gen_random_uuid(),
  schedule_entry_id uuid not null references schedule_entries (id) on delete cascade,
  kind text not null check (kind in ('pickup', 'dropoff')),
  date date not null,
  time time not null,
  employee_id uuid references employees (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'done')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (schedule_entry_id, kind)
);

alter table after_hours_transports enable row level security;

-- Admin sees all; an employee sees only the transports assigned to them.
-- All writes go through the RPCs below.
create policy "after_hours_transports_select" on after_hours_transports for select
  using (is_admin() or employee_id = current_employee_id());

-- Cancels (p_cancel) or restores the dog's regular hikes on the given days.
-- When cancelling a day that has no hike entry yet but is on the dog's weekly
-- pattern, inserts it already cancelled so the monthly backfill won't add an
-- active one later.
create function set_boarding_hikes(p_dog_id uuid, p_dates date[], p_cancel boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
begin
  if not is_admin() then
    raise exception 'Only admin can manage boarding';
  end if;

  foreach v_day in array p_dates loop
    if p_cancel then
      update schedule_entries
      set cancelled = true, cancel_reason = 'boarding',
          pickup_route_id = null, pickup_route_order = null,
          dropoff_route_id = null, dropoff_route_order = null,
          updated_at = now()
      where dog_id = p_dog_id and type = 'hike' and check_in_date = v_day and cancelled = false;

      insert into schedule_entries (
        dog_id, type, check_in_date, check_out_date, scheduled_pickup_date, scheduled_dropoff_date,
        cancelled, cancel_reason
      )
      select p_dog_id, 'hike', v_day, v_day, v_day, v_day, true, 'boarding'
      from dog_weekly_pattern dwp
      where dwp.dog_id = p_dog_id and dwp.day_of_week = extract(dow from v_day)
        and not exists (
          select 1 from schedule_entries se
          where se.dog_id = p_dog_id and se.type = 'hike' and se.check_in_date = v_day
        );
    else
      update schedule_entries
      set cancelled = false, cancel_reason = null, updated_at = now()
      where dog_id = p_dog_id and type = 'hike' and check_in_date = v_day
        and cancelled = true and cancel_reason = 'boarding';
    end if;
  end loop;
end;
$$;

create function book_boarding(p_dog_id uuid, p_check_in date, p_check_out date)
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

  perform set_boarding_hikes(p_dog_id, array[p_check_in, p_check_out], true);
  return v_id;
end;
$$;

create function change_boarding_dates(p_entry_id uuid, p_check_in date, p_check_out date)
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

  perform set_boarding_hikes(v_entry.dog_id, array[v_entry.check_in_date, v_entry.check_out_date], false);

  update schedule_entries
  set check_in_date = p_check_in,
      check_out_date = p_check_out,
      scheduled_pickup_date = p_check_in,
      scheduled_dropoff_date = p_check_out,
      -- A leg on a different day needs placing on that day's route afresh.
      pickup_route_id = case when p_check_in = v_entry.check_in_date then pickup_route_id end,
      pickup_route_order = case when p_check_in = v_entry.check_in_date then pickup_route_order end,
      dropoff_route_id = case when p_check_out = v_entry.check_out_date then dropoff_route_id end,
      dropoff_route_order = case when p_check_out = v_entry.check_out_date then dropoff_route_order end,
      updated_at = now()
  where id = p_entry_id;

  -- After-hours legs that were on the old check-in/out day follow it.
  update after_hours_transports set date = p_check_in
  where schedule_entry_id = p_entry_id and kind = 'pickup' and date = v_entry.check_in_date;
  update after_hours_transports set date = p_check_out
  where schedule_entry_id = p_entry_id and kind = 'dropoff' and date = v_entry.check_out_date;

  perform set_boarding_hikes(v_entry.dog_id, array[p_check_in, p_check_out], true);
end;
$$;

create function cancel_boarding(p_entry_id uuid)
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

  select * into v_entry from schedule_entries where id = p_entry_id and type = 'boarding';
  if not found then
    raise exception 'Boarding not found';
  end if;

  perform set_boarding_hikes(v_entry.dog_id, array[v_entry.check_in_date, v_entry.check_out_date], false);
  delete from after_hours_transports where schedule_entry_id = p_entry_id;
  update schedule_entries
  set cancelled = true, cancel_reason = 'other',
      pickup_route_id = null, pickup_route_order = null,
      dropoff_route_id = null, dropoff_route_order = null,
      after_hours_pickup = false, after_hours_dropoff = false,
      updated_at = now()
  where id = p_entry_id;
end;
$$;

-- Creates or updates a boarding stay's after-hours pickup or dropoff, and
-- takes that leg off the hike routes.
create function set_after_hours_transport(
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

  if p_kind = 'pickup' then
    update schedule_entries
    set after_hours_pickup = true, pickup_route_id = null, pickup_route_order = null, updated_at = now()
    where id = p_entry_id;
  else
    update schedule_entries
    set after_hours_dropoff = true, dropoff_route_id = null, dropoff_route_order = null, updated_at = now()
    where id = p_entry_id;
  end if;
end;
$$;

-- Puts a boarding leg back on the hike route.
create function remove_after_hours_transport(p_entry_id uuid, p_kind text)
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
  if p_kind = 'pickup' then
    update schedule_entries set after_hours_pickup = false, updated_at = now() where id = p_entry_id;
  elsif p_kind = 'dropoff' then
    update schedule_entries set after_hours_dropoff = false, updated_at = now() where id = p_entry_id;
  end if;
end;
$$;

-- Employee logs their after-hours pickup (with belongings) or dropoff.
create function log_after_hours_transport(p_transport_id uuid, p_belongings text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transport after_hours_transports%rowtype;
begin
  select * into v_transport from after_hours_transports
  where id = p_transport_id and employee_id = current_employee_id() and status = 'pending';
  if not found then
    raise exception 'Transport not found, not yours, or already logged';
  end if;

  update after_hours_transports set status = 'done', completed_at = now() where id = p_transport_id;

  if v_transport.kind = 'pickup' then
    update schedule_entries
    set pickup_status = 'picked_up', actual_pickup_at = now(),
        belongings_notes = coalesce(p_belongings, belongings_notes), updated_at = now()
    where id = v_transport.schedule_entry_id;
  else
    update schedule_entries
    set dropoff_status = 'dropped_off', actual_dropoff_at = now(), updated_at = now()
    where id = v_transport.schedule_entry_id;
  end if;
end;
$$;

-- log_pickup gains the belongings box for boarding dogs picked up on a route.
drop function log_pickup(uuid, text);
create function log_pickup(p_schedule_entry_id uuid, p_note text default null, p_belongings text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    and r.clocked_out_at is null;

  if not found then
    raise exception 'Schedule entry not found, not on your route, or you are not clocked in';
  end if;
end;
$$;

grant execute on function set_boarding_hikes(uuid, date[], boolean) to authenticated;
grant execute on function book_boarding(uuid, date, date) to authenticated;
grant execute on function change_boarding_dates(uuid, date, date) to authenticated;
grant execute on function cancel_boarding(uuid) to authenticated;
grant execute on function set_after_hours_transport(uuid, text, date, time, uuid) to authenticated;
grant execute on function remove_after_hours_transport(uuid, text) to authenticated;
grant execute on function log_after_hours_transport(uuid, text) to authenticated;
grant execute on function log_pickup(uuid, text, text) to authenticated;

-- A boarding dog's route legs (check-in pickup, check-out dropoff) go on the
-- dog's usual route for that weekday, same as their hike would have; legs
-- done after hours are left off the routes.
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
    where se.check_in_date = p_date
      and se.cancelled = false
      and se.after_hours_pickup = false
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
    where se.check_out_date = p_date
      and se.cancelled = false
      and se.late_pickup_by_owner = false
      and se.after_hours_dropoff = false
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
