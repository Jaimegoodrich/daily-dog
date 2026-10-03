-- 1) Lets admin send a dog's pickup or dropoff to Jaime's house instead of the
-- owner's address for one day, from the route's "Move to..." menu. Shown to
-- the employee on their route in place of the owner's address.
alter table schedule_entries add column pickup_at_jaimes boolean not null default false;
alter table schedule_entries add column dropoff_at_jaimes boolean not null default false;

-- 2) A boarding dog hikes every day it's at Jaime's, whether or not that's
-- one of its usual hike days: each night in the middle of a stay gets a hike
-- picked up from and dropped back at Jaime's. (The check-in and check-out days
-- are already covered by the stay's own pickup and dropoff.) Hikes made or
-- changed this way point back at the stay so they can be undone when it moves
-- or is cancelled.
alter table schedule_entries add column boarding_entry_id uuid
  references schedule_entries (id) on delete set null;

-- p_on: give every middle day of the stay a hike at Jaime's. Otherwise: undo
-- that for days not yet picked up -- a usual hike day goes back to the
-- owner's address, an extra day is removed.
create function set_boarding_stay_hikes(p_entry_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stay schedule_entries%rowtype;
  v_day date;
begin
  if not is_admin() then
    raise exception 'Only admin can manage boarding';
  end if;

  select * into v_stay from schedule_entries where id = p_entry_id and type = 'boarding';
  if not found then
    raise exception 'Boarding not found';
  end if;

  if p_on then
    v_day := v_stay.check_in_date + 1;
    while v_day < v_stay.check_out_date loop
      update schedule_entries
      set pickup_at_jaimes = true, dropoff_at_jaimes = true, boarding_entry_id = p_entry_id, updated_at = now()
      where dog_id = v_stay.dog_id and type = 'hike' and check_in_date = v_day and cancelled = false;

      insert into schedule_entries (
        dog_id, type, check_in_date, check_out_date, scheduled_pickup_date, scheduled_dropoff_date,
        pickup_at_jaimes, dropoff_at_jaimes, boarding_entry_id
      )
      select v_stay.dog_id, 'hike', v_day, v_day, v_day, v_day, true, true, p_entry_id
      where not exists (
        select 1 from schedule_entries se
        where se.dog_id = v_stay.dog_id and se.type = 'hike' and se.check_in_date = v_day
      );

      v_day := v_day + 1;
    end loop;
  else
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
  end if;
end;
$$;

grant execute on function set_boarding_stay_hikes(uuid, boolean) to authenticated;

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

  perform set_boarding_hikes(p_dog_id, array[p_check_in, p_check_out], true);
  perform set_boarding_stay_hikes(v_id, true);
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

  perform set_boarding_hikes(v_entry.dog_id, array[v_entry.check_in_date, v_entry.check_out_date], false);
  perform set_boarding_stay_hikes(p_entry_id, false);

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
  perform set_boarding_stay_hikes(p_entry_id, true);
end;
$$;

create or replace function cancel_boarding(p_entry_id uuid)
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
  perform set_boarding_stay_hikes(p_entry_id, false);
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
