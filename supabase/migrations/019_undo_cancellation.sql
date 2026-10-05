-- "Undo cancellation" on the Calendar: puts a cancelled hike back on the
-- schedule. If the dog is boarding that day, the stay's hikes are rebuilt so
-- the day gets its proper Jaime's pickup/dropoff. Route placement happens the
-- next time the day is opened (apply_default_routes_for_date), as for any
-- unassigned hike.
create function restore_hike(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry schedule_entries%rowtype;
  v_stay_id uuid;
begin
  if not is_admin() then
    raise exception 'Only admin can undo a cancellation';
  end if;

  update schedule_entries
  set cancelled = false, cancel_reason = null, late_cancel = false, updated_at = now()
  where id = p_entry_id and type = 'hike' and cancelled = true
  returning * into v_entry;
  if not found then
    raise exception 'Cancelled hike not found';
  end if;

  select id into v_stay_id
  from schedule_entries
  where type = 'boarding' and cancelled = false and dog_id = v_entry.dog_id
    and check_in_date <= v_entry.check_in_date and check_out_date >= v_entry.check_in_date
  limit 1;

  if v_stay_id is not null then
    perform clear_boarding_hikes(v_stay_id);
    perform build_boarding_hikes(v_stay_id);
  end if;
end;
$$;

grant execute on function restore_hike(uuid) to authenticated;
