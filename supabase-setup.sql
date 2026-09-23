-- ZeichenLex: eine gemeinsame Sammlung, OHNE Login.
-- WICHTIG: Diese Regeln erlauben anonymes Lesen/Schreiben.
-- Jeder, der Zugriff auf die veröffentlichte App hat, kann die Sammlung technisch verändern.

create table if not exists public.zeichenlex_entries (
  id text primary key,
  word text not null,
  aliases jsonb not null default '[]'::jsonb,
  notes text not null default '',
  favorite boolean not null default false,
  media_path text,
  media_type text,
  media_transform jsonb not null default '{"x":0,"y":0,"scale":1,"rotation":0,"fit":"cover"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.zeichenlex_entries enable row level security;

drop policy if exists "zeichenlex_public_select" on public.zeichenlex_entries;
drop policy if exists "zeichenlex_public_insert" on public.zeichenlex_entries;
drop policy if exists "zeichenlex_public_update" on public.zeichenlex_entries;
drop policy if exists "zeichenlex_public_delete" on public.zeichenlex_entries;

create policy "zeichenlex_public_select"
on public.zeichenlex_entries
for select
to anon
using (true);

create policy "zeichenlex_public_insert"
on public.zeichenlex_entries
for insert
to anon
with check (true);

create policy "zeichenlex_public_update"
on public.zeichenlex_entries
for update
to anon
using (true)
with check (true);

create policy "zeichenlex_public_delete"
on public.zeichenlex_entries
for delete
to anon
using (true);

insert into storage.buckets (id, name, public)
values ('zeichenlex-media', 'zeichenlex-media', true)
on conflict (id) do update set public = true;

drop policy if exists "zeichenlex_media_select" on storage.objects;
drop policy if exists "zeichenlex_media_insert" on storage.objects;
drop policy if exists "zeichenlex_media_update" on storage.objects;
drop policy if exists "zeichenlex_media_delete" on storage.objects;

create policy "zeichenlex_media_select"
on storage.objects
for select
to anon
using (bucket_id = 'zeichenlex-media');

create policy "zeichenlex_media_insert"
on storage.objects
for insert
to anon
with check (bucket_id = 'zeichenlex-media');

create policy "zeichenlex_media_update"
on storage.objects
for update
to anon
using (bucket_id = 'zeichenlex-media')
with check (bucket_id = 'zeichenlex-media');

create policy "zeichenlex_media_delete"
on storage.objects
for delete
to anon
using (bucket_id = 'zeichenlex-media');
