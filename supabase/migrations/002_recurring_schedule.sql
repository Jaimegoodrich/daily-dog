-- Adds recurring weekly hike patterns + proper cancellation tracking.
-- Run this in the SQL Editor AFTER schema.sql (it only adds new objects,
-- safe to run once on top of the existing database).

-- ==========================================================================
-- Recurring weekly pattern: which weekdays a dog hikes by default.
-- day_of_week matches JS Date.getDay() / Postgres extract(dow from date):
-- 0 = Sunday ... 6 = Saturday.
-- ==========================================================================
create table dog_weekly_pattern (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid not null references dogs (id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  created_at timestamptz not null default now(),
  unique (dog_id, day_of_week)
);

alter table dog_weekly_pattern enable row level security;

create policy "dog_weekly_pattern_select_authenticated" on dog_weekly_pattern for select
  using (auth.role() = 'authenticated');
create policy "dog_weekly_pattern_admin_insert" on dog_weekly_pattern for insert
  with check (is_admin());
create policy "dog_weekly_pattern_admin_delete" on dog_weekly_pattern for delete
  using (is_admin());

-- ==========================================================================
-- Cancellation fields on schedule_entries. A cancelled entry is kept (not
-- deleted) so cancellation history/reasons are preserved for reporting.
-- ==========================================================================
alter table schedule_entries add column cancelled boolean not null default false;
alter table schedule_entries add column cancel_reason text
  check (cancel_reason in ('vet', 'grooming', 'vacation', 'injury', 'other'));
alter table schedule_entries add column late_cancel boolean not null default false;

-- ==========================================================================
-- Backfills hike-type schedule_entries for every dog's recurring pattern,
-- for one calendar month. Idempotent: only inserts days that don't already
-- have an entry, so manually-added or already-cancelled days are untouched.
-- Called from the admin UI whenever a month is viewed, so upcoming weeks
-- are always populated without needing a scheduled job.
-- ==========================================================================
create function ensure_schedule_for_month(p_year int, p_month int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date := make_date(p_year, p_month, 1);
  v_end date := (v_start + interval '1 month')::date;
  v_day date;
begin
  if not is_admin() then
    raise exception 'Only admin can generate schedule';
  end if;

  v_day := v_start;
  while v_day < v_end loop
    insert into schedule_entries (
      dog_id, type, check_in_date, check_out_date, scheduled_pickup_date, scheduled_dropoff_date
    )
    select dwp.dog_id, 'hike', v_day, v_day, v_day, v_day
    from dog_weekly_pattern dwp
    where dwp.day_of_week = extract(dow from v_day)
      and not exists (
        select 1 from schedule_entries se
        where se.dog_id = dwp.dog_id and se.type = 'hike' and se.check_in_date = v_day
      );
    v_day := v_day + interval '1 day';
  end loop;
end;
$$;

grant execute on function ensure_schedule_for_month(int, int) to authenticated;
