-- Lets a photo be tagged with more than one dog via a join table, replacing
-- the single dog_id column on photos.
create table photo_tags (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references photos (id) on delete cascade,
  dog_id uuid not null references dogs (id) on delete cascade,
  unique (photo_id, dog_id)
);

alter table photo_tags enable row level security;

create policy "photo_tags_select_authenticated" on photo_tags for select
  using (auth.role() = 'authenticated');
create policy "photo_tags_insert_authenticated" on photo_tags for insert
  with check (auth.role() = 'authenticated');
create policy "photo_tags_admin_delete" on photo_tags for delete
  using (is_admin());

alter table photos drop column dog_id;
