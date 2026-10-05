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
  clocked_in_at timestamptz,
  clocked_out_at timestamptz,
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
  -- Boarding: belongings/food/medication logged at pickup, shown at dropoff.
  belongings_notes text,
  -- Boarding: that leg is an After Hours Transport instead of a hike route.
  after_hours_pickup boolean not null default false,
  after_hours_dropoff boolean not null default false,
  -- That leg happens at Jaime's house instead of the owner's address.
  pickup_at_jaimes boolean not null default false,
  dropoff_at_jaimes boolean not null default false,
  -- A hike made or moved to Jaime's by a boarding stay (undone if the stay
  -- moves or is cancelled).
  boarding_entry_id uuid references schedule_entries (id) on delete set null,
  cancelled boolean not null default false,
  -- 'boarding': a regular hike covered by a boarding stay's own pickup/dropoff.
  cancel_reason text check (cancel_reason in ('vet', 'grooming', 'vacation', 'injury', 'rain', 'heat', 'admin', 'boarding', 'other')),
  late_cancel boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Recurring weekly hike pattern per dog: which weekdays a dog hikes by
-- default, and optionally which route number they default onto for that
-- weekday (day_of_week matches JS Date.getDay() / Postgres extract(dow)).
-- A boarding stay's pickup or dropoff done outside hike routes, at a set time
-- by one employee.
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

create table dog_weekly_pattern (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid not null references dogs (id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  default_route_number int check (default_route_number between 1 and 3),
  default_dropoff_route_number int check (default_dropoff_route_number between 1 and 3),
  default_pickup_order int,
  default_dropoff_order int,
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

-- Good-morning note from the admin to the team, one per date.
create table admin_notes (
  date date primary key,
  note text not null,
  updated_at timestamptz not null default now()
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

-- Sets a dog's default route (both pickup and dropoff) for a weekday, from
-- the Weekly Schedule page's per-day route picker.
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

  insert into dog_weekly_pattern (dog_id, day_of_week, default_route_number, default_dropoff_route_number)
  values (p_dog_id, p_day_of_week, p_route_number, p_route_number)
  on conflict (dog_id, day_of_week)
  do update set default_route_number = excluded.default_route_number,
                default_dropoff_route_number = excluded.default_dropoff_route_number,
                default_pickup_order = null,
                default_dropoff_order = null;
end;
$$;

grant execute on function set_default_route(uuid, int, int) to authenticated;

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

grant execute on function save_route_as_default(uuid, text) to authenticated;
grant execute on function clear_default_route(uuid, int, text) to authenticated;

-- Fills in pickup_route_id/dropoff_route_id for any of the date's hike
-- entries that are missing one, using each dog's default route number for
-- that weekday, if a route with that number already exists for the date.
-- Honors a stored default order (default_pickup_order/default_dropoff_order)
-- when set, falling back to appending at the end otherwise. Safe to call
-- repeatedly (only ever fills in nulls, never overrides a manual
-- assignment).
create function apply_default_routes_for_date(p_date date)
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

grant execute on function apply_default_routes_for_date(date) to authenticated;

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

grant execute on function prepare_day(date) to authenticated;

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
alter table after_hours_transports enable row level security;
alter table dog_weekly_pattern enable row level security;
alter table daily_reports enable row level security;
alter table admin_notes enable row level security;
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

-- after_hours_transports: Admin sees all; an employee sees only the transports assigned to them.
-- All writes go through the RPCs below.
create policy "after_hours_transports_select" on after_hours_transports for select
  using (is_admin() or employee_id = current_employee_id());

-- admin_notes: any signed-in staff can read, only admin can write.
create policy "admin_notes_select_authenticated" on admin_notes for select
  using (auth.role() = 'authenticated');
create policy "admin_notes_admin_insert" on admin_notes for insert with check (is_admin());
create policy "admin_notes_admin_update" on admin_notes for update using (is_admin()) with check (is_admin());
create policy "admin_notes_admin_delete" on admin_notes for delete using (is_admin());

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

create function clock_out(p_route_id uuid)
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

create function log_pickup(p_schedule_entry_id uuid, p_note text default null, p_belongings text default null)
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

create function log_dropoff(p_schedule_entry_id uuid, p_note text default null)
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
grant execute on function log_pickup(uuid, text, text) to authenticated;
grant execute on function log_dropoff(uuid, text) to authenticated;
grant execute on function clock_out(uuid) to authenticated;
grant execute on function log_late_cancel(uuid, text) to authenticated;
grant execute on function submit_daily_report(uuid, text, text, text) to authenticated;

-- ==========================================================================
-- BOARDING (admin books stays; employees log after-hours transports)
-- ==========================================================================

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

-- Undo a hike's cancellation (Calendar); rebuilds a boarding stay covering that day.
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

  perform build_boarding_hikes(v_id);
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

create function cancel_boarding(p_entry_id uuid)
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

  perform clear_boarding_hikes(p_entry_id);
  if p_kind = 'pickup' then
    update schedule_entries set after_hours_pickup = true, updated_at = now() where id = p_entry_id;
  else
    update schedule_entries set after_hours_dropoff = true, updated_at = now() where id = p_entry_id;
  end if;
  perform build_boarding_hikes(p_entry_id);
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
  perform clear_boarding_hikes(p_entry_id);
  if p_kind = 'pickup' then
    update schedule_entries set after_hours_pickup = false, updated_at = now() where id = p_entry_id;
  elsif p_kind = 'dropoff' then
    update schedule_entries set after_hours_dropoff = false, updated_at = now() where id = p_entry_id;
  end if;
  perform build_boarding_hikes(p_entry_id);
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

grant execute on function restore_hike(uuid) to authenticated;
grant execute on function book_boarding(uuid, date, date) to authenticated;
grant execute on function change_boarding_dates(uuid, date, date) to authenticated;
grant execute on function cancel_boarding(uuid) to authenticated;
grant execute on function set_after_hours_transport(uuid, text, date, time, uuid) to authenticated;
grant execute on function remove_after_hours_transport(uuid, text) to authenticated;
grant execute on function log_after_hours_transport(uuid, text) to authenticated;

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
