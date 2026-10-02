-- Employees clock in at the very start of a route and clock out at the very
-- end; payroll hours run from clock-in to clock-out. Clocking in replaces the
-- old "Start Route" step (start_route now stamps the time), dogs can only be
-- logged while clocked in, and clocking out requires every dog on the route
-- to be dropped off.
alter table routes add column clocked_in_at timestamptz;
alter table routes add column clocked_out_at timestamptz;

create or replace function start_route(p_route_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update routes
  set status = 'in_progress',
      clocked_in_at = now()
  where id = p_route_id
    and employee_id = current_employee_id()
    and status = 'pending';

  if not found then
    raise exception 'Route not found, not yours, or already started';
  end if;
end;
$$;

create function clock_out(p_route_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending_dropoffs int;
begin
  perform 1 from routes
  where id = p_route_id
    and employee_id = current_employee_id()
    and status = 'in_progress'
    and clocked_out_at is null;
  if not found then
    raise exception 'Route not found, not yours, not clocked in, or already clocked out';
  end if;

  select count(*) into v_pending_dropoffs
  from schedule_entries
  where dropoff_route_id = p_route_id
    and dropoff_status = 'pending'
    and late_pickup_by_owner = false;

  if v_pending_dropoffs > 0 then
    raise exception 'All dogs on this route must be logged as dropped off first';
  end if;

  update routes set clocked_out_at = now() where id = p_route_id;
end;
$$;

create or replace function log_pickup(p_schedule_entry_id uuid, p_note text default null)
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

create or replace function log_dropoff(p_schedule_entry_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    and r.clocked_out_at is null;

  if not found then
    raise exception 'Schedule entry not found, not on your route, or you are not clocked in';
  end if;
end;
$$;

grant execute on function clock_out(uuid) to authenticated;
