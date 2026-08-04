-- =====================================================================
-- Saved CSVs, birth charts, and the contact inbox
--
-- Three small tables, all private to their owner except the last, which is
-- write-only for members and readable by nobody through the API.
--
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- History table snapshots, stored as the CSV the app already exports
--
-- Same reasoning as presets: the calculator owns the format, so keeping the
-- exported text verbatim means loading one reuses the existing import path
-- rather than a second parallel one that has to be kept in step.
-- ---------------------------------------------------------------------

create table if not exists public.history_csv (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  csv         text not null,
  rows        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint history_csv_name_not_blank check (length(btrim(name)) > 0),
  constraint history_csv_name_len check (length(name) <= 60),
  constraint history_csv_size check (length(csv) <= 5000000)
);

comment on table public.history_csv is
  'Saved History Table exports, in the app''s own CSV format.';

create unique index if not exists history_csv_user_name_key
  on public.history_csv (user_id, lower(btrim(name)));
create index if not exists history_csv_user_idx on public.history_csv (user_id);

drop trigger if exists history_csv_touch_updated_at on public.history_csv;
create trigger history_csv_touch_updated_at
  before update on public.history_csv
  for each row execute function public.touch_updated_at();

alter table public.history_csv enable row level security;

drop policy if exists "history_csv_select_own" on public.history_csv;
create policy "history_csv_select_own" on public.history_csv for select
  to authenticated using ( (select auth.uid()) = user_id );

drop policy if exists "history_csv_insert_own" on public.history_csv;
create policy "history_csv_insert_own" on public.history_csv for insert
  to authenticated with check ( (select auth.uid()) = user_id );

drop policy if exists "history_csv_update_own" on public.history_csv;
create policy "history_csv_update_own" on public.history_csv for update
  to authenticated using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "history_csv_delete_own" on public.history_csv;
create policy "history_csv_delete_own" on public.history_csv for delete
  to authenticated using ( (select auth.uid()) = user_id );

revoke all on public.history_csv from anon, authenticated;
grant select, insert, update, delete on public.history_csv to authenticated;

-- ---------------------------------------------------------------------
-- Birth charts
--
-- Only the inputs are stored, never the computed positions: the chart is
-- derived from these five fields, so keeping the result as well would just be
-- a second copy to fall out of date the next time the ephemeris changes.
--
-- This is personal data - a date, time and place of birth identifies someone
-- fairly precisely - so it is private to its owner with no public view over
-- it, unlike submissions.
-- ---------------------------------------------------------------------

create table if not exists public.birth_charts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  birth_date  text not null,
  birth_time  text not null default '',
  place       text not null default '',
  latitude    double precision,
  longitude   double precision,
  tz_offset   double precision,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint birth_charts_name_not_blank check (length(btrim(name)) > 0),
  constraint birth_charts_name_len check (length(name) <= 60),
  constraint birth_charts_lat check (latitude is null or (latitude >= -90 and latitude <= 90)),
  constraint birth_charts_lon check (longitude is null or (longitude >= -180 and longitude <= 180))
);

comment on table public.birth_charts is
  'Saved birth chart inputs. Private to the owner: date, time and place of birth are personal data.';

create unique index if not exists birth_charts_user_name_key
  on public.birth_charts (user_id, lower(btrim(name)));
create index if not exists birth_charts_user_idx on public.birth_charts (user_id);

drop trigger if exists birth_charts_touch_updated_at on public.birth_charts;
create trigger birth_charts_touch_updated_at
  before update on public.birth_charts
  for each row execute function public.touch_updated_at();

alter table public.birth_charts enable row level security;

drop policy if exists "birth_charts_select_own" on public.birth_charts;
create policy "birth_charts_select_own" on public.birth_charts for select
  to authenticated using ( (select auth.uid()) = user_id );

drop policy if exists "birth_charts_insert_own" on public.birth_charts;
create policy "birth_charts_insert_own" on public.birth_charts for insert
  to authenticated with check ( (select auth.uid()) = user_id );

drop policy if exists "birth_charts_update_own" on public.birth_charts;
create policy "birth_charts_update_own" on public.birth_charts for update
  to authenticated using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "birth_charts_delete_own" on public.birth_charts;
create policy "birth_charts_delete_own" on public.birth_charts for delete
  to authenticated using ( (select auth.uid()) = user_id );

revoke all on public.birth_charts from anon, authenticated;
grant select, insert, update, delete on public.birth_charts to authenticated;

-- ---------------------------------------------------------------------
-- Contact inbox
--
-- Write-only from the site: a signed-in member can add a message and nothing
-- more. There is no select policy at all, so no one can read this table
-- through the API - not even the person who wrote the row. Read it in the
-- Supabase dashboard, or from a service_role job that forwards it on.
--
-- Anonymous visitors are deliberately not allowed to write: an open insert
-- endpoint on a public key is a spam queue.
-- ---------------------------------------------------------------------

create table if not exists public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  topic       text not null,
  message     text not null,
  reply_to    text not null default '',
  handled     boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint contact_topic_len check (length(topic) <= 80),
  constraint contact_message_not_blank check (length(btrim(message)) > 0),
  constraint contact_message_len check (length(message) <= 4000),
  constraint contact_reply_to_len check (length(reply_to) <= 320)
);

comment on table public.contact_messages is
  'Messages sent from the Contact Us panel. Insert-only for members; readable only with the service role.';

create index if not exists contact_messages_created_idx
  on public.contact_messages (created_at desc) where not handled;

alter table public.contact_messages enable row level security;

drop policy if exists "contact_insert_own" on public.contact_messages;
create policy "contact_insert_own" on public.contact_messages for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

-- no select, update or delete policy: RLS denies by default, so the table is
-- write-only through the API and the dashboard is the way in

revoke all on public.contact_messages from anon, authenticated;
grant insert on public.contact_messages to authenticated;
