-- Daily Dog: full schema, RLS policies, and RPC functions.
-- Run this once against your Supabase project (SQL Editor -> paste -> Run).

-- Supabase installs this into the "extensions" schema, not "public" — every
-- function below that calls crypt()/gen_salt() must include "extensions" in
-- its search_path or the calls silently fail to resolve.
create extension if not exists pgcrypto with schema extensions;

-- ==========================================================================
-- ENUMS
-- ==========================================================================
create type app_role as enum ('admin', 'employee');
create type household_role as enum ('owner', 'nanny', 'house_manager', 'housekeeper', 'chef', 'personal_assistant');
create type schedule_type as enum ('hike', 'boarding');
create type route_status as enum ('pending', 'in_progress', 'completed');

-- ==========================================================================
-- TABLES
-- ==========================================================================

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role app_role not null default 'employee',
  created_at timestamptz not null default now()
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references profiles (id) on delete cascade,
  display_name text not null,
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  main_name text not null,
  spouse_name text,
  address text,
  primary_contact_name text,
  primary_contact_role household_role,
  primary_phone text,
  secondary_contact_name text,
  secondary_contact_role household_role,
  secondary_phone text,
  contact3_name text,
  contact3_role household_role,
  contact3_phone text,
  gate_code text,
  alarm_code text,
  pickup_notes text,
  dropoff_notes text,
  additional_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table children (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  name text not null,
  phone text
);

create table household_members (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  name text not null,
  role household_role,
  phone text
);

create table dogs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  name text not null,
  breed text,
  birthday date,
  seating_position text,
  quirks text,
  health_issues text,
  medications text,
  food_brand text,
  feeding_instructions text,
  picture_url text,
  vet_name text,
  vet_clinic_name text,
  vet_phone text,
  created_at timestamptz not null default now()
);

create table routes (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  route_number int not null check (route_number between 1 and 3),
  employee_id uuid references employees (id) on delete set null,
  status route_status not null default 'pending',
  arrived_at_farm_at timestamptz,
  left_farm_at timestamptz,
  created_at timestamptz not null default now(),
  unique (date, route_number)
);

create table schedule_entries (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid not null references dogs (id) on delete cascade,
  type schedule_type not null,
  -- check_in_date: day the dog is picked up. check_out_date: day the dog is dropped off.
  -- For a daily hike these are the same day. For boarding they default to the
  -- hike-day pickup/dropoff (e.g. a Tue-night boarder is picked up for Monday's
  -- hike, dropped off after Tuesday's hike) but can be overridden below.
  check_in_date date not null,
  check_out_date date not null,
  scheduled_pickup_date date not null,
  scheduled_pickup_time time,
  scheduled_dropoff_date date not null,
  scheduled_dropoff_time time,
  late_pickup_by_owner boolean not null default false,
  pickup_route_id uuid references routes (id) on delete set null,
  pickup_route_order int,
  dropoff_route_id uuid references routes (id) on delete set null,
  dropoff_route_order int,
  pickup_status text not null default 'pending' check (pickup_status in ('pending', 'picked_up')),
  dropoff_status text not null default 'pending' check (dropoff_status in ('pending', 'dropped_off')),
  actual_pickup_at timestamptz,
  actual_dropoff_at timestamptz,
  pickup_issue_notes text,
  dropoff_issue_notes text,
  cancelled boolean not null default false,
  cancel_reason text check (cancel_reason in ('vet', 'grooming', 'vacation', 'injury', 'other')),
  late_cancel boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Recurring weekly hike pattern per dog: which weekdays a dog hikes by
-- default, and optionally which route number they default onto for that
-- weekday (day_of_week matches JS Date.getDay() / Postgres extract(dow)).
create table dog_weekly_pattern (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid not null references dogs (id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  default_route_number int check (default_route_number between 1 and 3),
  created_at timestamptz not null default now(),
  unique (dog_id, day_of_week)
);

create table daily_reports (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id) on delete cascade,
  route_id uuid not null unique references routes (id) on delete cascade,
  date date not null,
  van_issues text,
  farm_issues text,
  client_issues text,
  submitted_at timestamptz not null default now()
);

create table photos (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references employees (id) on delete set null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

-- A photo can be tagged with more than one dog.
create table photo_tags (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references photos (id) on delete cascade,
  dog_id uuid not null references dogs (id) on delete cascade,
  unique (photo_id, dog_id)
);

-- ==========================================================================
-- HELPERS
-- ==========================================================================

create function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

create function current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from employees where profile_id = auth.uid();
$$;

-- Publicly listable (no auth required) directory for the PIN login screen.
-- Deliberately excludes pin_hash.
create function list_active_employees()
returns table (id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select id, display_name from employees where active = true order by display_name;
$$;

grant execute on function list_active_employees() to anon, authenticated;

-- Used only by the pin-login Edge Function (service role), never exposed to clients.
create function check_pin(p_pin text, p_hash text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select crypt(p_pin, p_hash) = p_hash;
$$;

revoke all on function check_pin(text, text) from public, anon, authenticated;
grant execute on function check_pin(text, text) to service_role;

-- Used only by the admin-create-employee Edge Function (service role).
create function create_employee_record(p_profile_id uuid, p_display_name text, p_pin text)
returns uuid
language sql
security definer
set search_path = public, extensions
as $$
  insert into employees (profile_id, display_name, pin_hash)
  values (p_profile_id, p_display_name, crypt(p_pin, gen_salt('bf')))
  returning id;
$$;

revoke all on function create_employee_record(uuid, text, text) from public, anon, authenticated;
grant execute on function create_employee_record(uuid, text, text) to service_role;

-- Auto-create a profiles row whenever an auth user is created (both admin and
-- employee accounts go through supabase.auth.admin.createUser with this metadata).
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', 'New User'),
    coalesce((new.raw_user_meta_data ->> 'role')::app_role, 'employee')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Admin resets an employee's PIN (bcrypt hashing happens server-side here since
-- a plain client update can't compute the pgcrypto hash).
create function admin_set_employee_pin(p_employee_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not is_admin() then
    raise exception 'Only admin can reset PINs';
  end if;

  update employees set pin_hash = crypt(p_pin, gen_salt('bf')) where id = p_employee_id;
end;
$$;

grant execute on function admin_set_employee_pin(uuid, text) to authenticated;

-- Backfills hike-type schedule_entries for every dog's recurring pattern,
-- for one calendar month. Idempotent: only inserts days that don't already
-- have an entry, so manually-added or already-cancelled days are untouched.
-- Called from the admin UI whenever a month is viewed, so upcoming weeks
-- are always populated without needing a scheduled job.
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

-- Called by the client whenever admin assigns a dog's pickup or dropoff to a
-- route, to remember that route number as the default for this weekday.
create function set_default_route(p_dog_id uuid, p_day_of_week int, p_route_number int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only admin can set default routes';
  end if;

  insert into dog_weekly_pattern (dog_id, day_of_week, default_route_number)
  values (p_dog_id, p_day_of_week, p_route_number)
  on conflict (dog_id, day_of_week)
  do update set default_route_number = excluded.default_route_number;
end;
$$;

grant execute on function set_default_route(uuid, int, int) to authenticated;

-- Fills in pickup_route_id/dropoff_route_id for any of the date's hike
-- entries that are missing one, using each dog's default route number for
-- that weekday, if a route with that number already exists for the date.
-- Safe to call repeatedly (only ever fills in nulls, never overrides a
-- manual assignment).
create function apply_default_routes_for_date(p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dow int := extract(dow from p_date);
  v_entry record;
  v_route_id uuid;
  v_next_order int;
begin
  if not is_admin() then
    raise exception 'Only admin can apply default routes';
  end if;

  for v_entry in
    select se.id, dwp.default_route_number
    from schedule_entries se
    join dog_weekly_pattern dwp on dwp.dog_id = se.dog_id and dwp.day_of_week = v_dow
    where se.type = 'hike'
      and se.check_in_date = p_date
      and se.cancelled = false
      and se.pickup_route_id is null
      and dwp.default_route_number is not null
    order by se.created_at
  loop
    select id into v_route_id from routes where date = p_date and route_number = v_entry.default_route_number;
    if v_route_id is not null then
      select coalesce(max(pickup_route_order) + 1, 0) into v_next_order
      from schedule_entries where pickup_route_id = v_route_id;
      update schedule_entries set pickup_route_id = v_route_id, pickup_route_order = v_next_order
      where id = v_entry.id;
    end if;
  end loop;

  for v_entry in
    select se.id, dwp.default_route_number
    from schedule_entries se
    join dog_weekly_pattern dwp on dwp.dog_id = se.dog_id and dwp.day_of_week = v_dow
    where se.type = 'hike'
      and se.check_out_date = p_date
      and se.cancelled = false
      and se.late_pickup_by_owner = false
      and se.dropoff_route_id is null
      and dwp.default_route_number is not null
    order by se.created_at
  loop
    select id into v_route_id from routes where date = p_date and route_number = v_entry.default_route_number;
    if v_route_id is not null then
      select coalesce(max(dropoff_route_order) + 1, 0) into v_next_order
      from schedule_entries where dropoff_route_id = v_route_id;
      update schedule_entries set dropoff_route_id = v_route_id, dropoff_route_order = v_next_order
      where id = v_entry.id;
    end if;
  end loop;
end;
$$;

grant execute on function apply_default_routes_for_date(date) to authenticated;

-- ==========================================================================
-- ROW LEVEL SECURITY
-- ==========================================================================

alter table profiles enable row level security;
alter table employees enable row level security;
alter table clients enable row level security;
alter table children enable row level security;
alter table household_members enable row level security;
alter table dogs enable row level security;
alter table routes enable row level security;
alter table schedule_entries enable row level security;
alter table dog_weekly_pattern enable row level security;
alter table daily_reports enable row level security;
alter table photos enable row level security;
alter table photo_tags enable row level security;

-- profiles
create policy "profiles_select_own_or_admin" on profiles for select
  using (id = auth.uid() or is_admin());
create policy "profiles_admin_write" on profiles for all
  using (is_admin()) with check (is_admin());

-- employees
create policy "employees_select_own_or_admin" on employees for select
  using (profile_id = auth.uid() or is_admin());
create policy "employees_admin_write" on employees for insert
  with check (is_admin());
create policy "employees_admin_update" on employees for update
  using (is_admin()) with check (is_admin());
create policy "employees_admin_delete" on employees for delete
  using (is_admin());

-- clients / children / household_members / dogs: any signed-in staff can read,
-- only admin can write.
create policy "clients_select_authenticated" on clients for select
  using (auth.role() = 'authenticated');
create policy "clients_admin_write" on clients for insert with check (is_admin());
create policy "clients_admin_update" on clients for update using (is_admin()) with check (is_admin());
create policy "clients_admin_delete" on clients for delete using (is_admin());

create policy "children_select_authenticated" on children for select
  using (auth.role() = 'authenticated');
create policy "children_admin_write" on children for insert with check (is_admin());
create policy "children_admin_update" on children for update using (is_admin()) with check (is_admin());
create policy "children_admin_delete" on children for delete using (is_admin());

create policy "household_members_select_authenticated" on household_members for select
  using (auth.role() = 'authenticated');
create policy "household_members_admin_write" on household_members for insert with check (is_admin());
create policy "household_members_admin_update" on household_members for update using (is_admin()) with check (is_admin());
create policy "household_members_admin_delete" on household_members for delete using (is_admin());

create policy "dogs_select_authenticated" on dogs for select
  using (auth.role() = 'authenticated');
create policy "dogs_admin_write" on dogs for insert with check (is_admin());
create policy "dogs_admin_update" on dogs for update using (is_admin()) with check (is_admin());
create policy "dogs_admin_delete" on dogs for delete using (is_admin());

-- routes: staff can see their own route or admin sees all; only admin edits directly
-- (employees change route.status only via the start_shift/submit_daily_report RPCs below).
create policy "routes_select" on routes for select
  using (employee_id = current_employee_id() or is_admin());
create policy "routes_admin_write" on routes for insert with check (is_admin());
create policy "routes_admin_update" on routes for update using (is_admin()) with check (is_admin());
create policy "routes_admin_delete" on routes for delete using (is_admin());

-- schedule_entries: any signed-in staff can read (need pickup notes/gate codes);
-- only admin writes directly (employees log pickup/dropoff via RPCs below).
create policy "schedule_entries_select_authenticated" on schedule_entries for select
  using (auth.role() = 'authenticated');
create policy "schedule_entries_admin_write" on schedule_entries for insert with check (is_admin());
create policy "schedule_entries_admin_update" on schedule_entries for update using (is_admin()) with check (is_admin());
create policy "schedule_entries_admin_delete" on schedule_entries for delete using (is_admin());

-- dog_weekly_pattern
create policy "dog_weekly_pattern_select_authenticated" on dog_weekly_pattern for select
  using (auth.role() = 'authenticated');
create policy "dog_weekly_pattern_admin_insert" on dog_weekly_pattern for insert
  with check (is_admin());
create policy "dog_weekly_pattern_admin_delete" on dog_weekly_pattern for delete
  using (is_admin());

-- daily_reports
create policy "daily_reports_select" on daily_reports for select
  using (employee_id = current_employee_id() or is_admin());
create policy "daily_reports_insert_own" on daily_reports for insert
  with check (employee_id = current_employee_id());

-- photos
create policy "photos_select_authenticated" on photos for select
  using (auth.role() = 'authenticated');
create policy "photos_insert_authenticated" on photos for insert
  with check (auth.role() = 'authenticated');
create policy "photos_admin_delete" on photos for delete using (is_admin());

-- photo_tags
create policy "photo_tags_select_authenticated" on photo_tags for select
  using (auth.role() = 'authenticated');
create policy "photo_tags_insert_authenticated" on photo_tags for insert
  with check (auth.role() = 'authenticated');
create policy "photo_tags_admin_delete" on photo_tags for delete using (is_admin());

-- ==========================================================================
-- EMPLOYEE ACTION RPCs (SECURITY DEFINER: bypass table RLS but self-check
-- that the caller actually owns the route being touched)
-- ==========================================================================

create function start_route(p_route_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update routes
  set status = 'in_progress'
  where id = p_route_id
    and employee_id = current_employee_id()
    and status = 'pending';

  if not found then
    raise exception 'Route not found, not yours, or already started';
  end if;
end;
$$;

create function log_farm_arrival(p_route_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update routes set arrived_at_farm_at = now() where id = p_route_id and employee_id = current_employee_id();
  if not found then
    raise exception 'Route not found or not yours';
  end if;
end;
$$;

create function log_farm_departure(p_route_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update routes set left_farm_at = now() where id = p_route_id and employee_id = current_employee_id();
  if not found then
    raise exception 'Route not found or not yours';
  end if;
end;
$$;

create function log_pickup(p_schedule_entry_id uuid, p_note text default null)
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
    and r.employee_id = current_employee_id();

  if not found then
    raise exception 'Schedule entry not found or not on your route';
  end if;
end;
$$;

create function log_dropoff(p_schedule_entry_id uuid, p_note text default null)
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
    and r.employee_id = current_employee_id();

  if not found then
    raise exception 'Schedule entry not found or not on your route';
  end if;
end;
$$;

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

create function submit_daily_report(
  p_route_id uuid,
  p_van_issues text default null,
  p_farm_issues text default null,
  p_client_issues text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route routes%rowtype;
  v_pending_dropoffs int;
  v_report_id uuid;
begin
  select * into v_route from routes where id = p_route_id and employee_id = current_employee_id();
  if not found then
    raise exception 'Route not found or not yours';
  end if;

  select count(*) into v_pending_dropoffs
  from schedule_entries
  where dropoff_route_id = p_route_id
    and dropoff_status = 'pending'
    and late_pickup_by_owner = false;

  if v_pending_dropoffs > 0 then
    raise exception 'All dogs on this route must be logged as dropped off first';
  end if;

  insert into daily_reports (employee_id, route_id, date, van_issues, farm_issues, client_issues)
  values (current_employee_id(), p_route_id, v_route.date, p_van_issues, p_farm_issues, p_client_issues)
  returning id into v_report_id;

  update routes set status = 'completed' where id = p_route_id;

  return v_report_id;
end;
$$;

grant execute on function start_route(uuid) to authenticated;
grant execute on function log_farm_arrival(uuid) to authenticated;
grant execute on function log_farm_departure(uuid) to authenticated;
grant execute on function log_pickup(uuid, text) to authenticated;
grant execute on function log_dropoff(uuid, text) to authenticated;
grant execute on function log_late_cancel(uuid, text) to authenticated;
grant execute on function submit_daily_report(uuid, text, text, text) to authenticated;

-- ==========================================================================
-- STORAGE (create the bucket first in the Supabase dashboard: Storage -> New
-- bucket -> name "media" -> Public: off. Then run the policies below.)
-- ==========================================================================

create policy "media_read_authenticated" on storage.objects for select
  using (bucket_id = 'media' and auth.role() = 'authenticated');
create policy "media_insert_authenticated" on storage.objects for insert
  with check (bucket_id = 'media' and auth.role() = 'authenticated');
create policy "media_delete_admin" on storage.objects for delete
  using (bucket_id = 'media' and is_admin());
