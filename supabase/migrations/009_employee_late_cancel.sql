-- Lets an employee mark a dog as a late cancel right from their route run,
-- for the case where they arrive for pickup and the dog isn't there. Cancels
-- the whole hike for the day (clears both pickup and dropoff route slots,
-- since there's nothing to drop off if the dog was never picked up) rather
-- than just skipping the pickup step.
create function log_late_cancel(p_schedule_entry_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update schedule_entries se
  set cancelled = true,
      cancel_reason = 'other',
      late_cancel = true,
      pickup_issue_notes = coalesce(p_note, se.pickup_issue_notes),
      pickup_route_id = null,
      pickup_route_order = null,
      dropoff_route_id = null,
      dropoff_route_order = null,
      updated_at = now()
  from routes r
  where se.id = p_schedule_entry_id
    and se.pickup_route_id = r.id
    and r.employee_id = current_employee_id()
    and se.pickup_status = 'pending';

  if not found then
    raise exception 'Schedule entry not found, not on your route, or already picked up';
  end if;
end;
$$;

grant execute on function log_late_cancel(uuid, text) to authenticated;
