-- A "good morning" note the admin writes for the team about a given day
-- (changes, issues, reminders). One note per date; employees see the note for
-- today on their opening screen. Only admin can write; any signed-in staff can
-- read.
create table admin_notes (
  date date primary key,
  note text not null,
  updated_at timestamptz not null default now()
);

alter table admin_notes enable row level security;

create policy "admin_notes_select_authenticated" on admin_notes for select
  using (auth.role() = 'authenticated');
create policy "admin_notes_admin_insert" on admin_notes for insert with check (is_admin());
create policy "admin_notes_admin_update" on admin_notes for update using (is_admin()) with check (is_admin());
create policy "admin_notes_admin_delete" on admin_notes for delete using (is_admin());
