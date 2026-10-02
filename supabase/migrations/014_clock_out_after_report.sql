-- Clocking out is now the very last step, after the end of shift report:
-- the route must be completed (report submitted, which already requires every
-- dog dropped off) before the employee can clock out.
create or replace function clock_out(p_route_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update routes
  set clocked_out_at = now()
  where id = p_route_id
    and employee_id = current_employee_id()
    and status = 'completed'
    and clocked_out_at is null;

  if not found then
    raise exception 'Route not found, not yours, end of shift report not submitted, or already clocked out';
  end if;
end;
$$;
