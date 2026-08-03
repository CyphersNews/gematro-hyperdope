-- =====================================================================
-- Saved phrase history
--
-- The History Table currently lives only in memory, so a refresh wipes it.
-- For signed-in users it is mirrored here instead.
--
-- One row per phrase rather than a single JSON blob per user: it keeps the
-- rows queryable, lets a phrase be starred or annotated later without a
-- migration, and means a single edit does not rewrite the whole history.
--
-- Safe to re-run.
-- =====================================================================

create table if not exists public.history_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  phrase      text not null,
  position    integer not null default 0,   -- preserves History Table order
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint history_entries_phrase_not_blank check (length(btrim(phrase)) > 0),
  constraint history_entries_phrase_len check (length(phrase) <= 2000)
);

comment on table public.history_entries is
  'One saved History Table phrase per row, scoped to a single user.';

-- The calculator already treats re-entering a phrase as a move rather than a
-- duplicate; this makes the database agree, and lets the client upsert safely.
create unique index if not exists history_entries_user_phrase_key
  on public.history_entries (user_id, phrase);

-- the read path is always "this user's rows, in order"
create index if not exists history_entries_user_position_idx
  on public.history_entries (user_id, position);

drop trigger if exists history_entries_touch_updated_at on public.history_entries;
create trigger history_entries_touch_updated_at
  before update on public.history_entries
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security
--
-- Same shape as profiles, with one difference: this table does need a delete
-- policy, because clearing your history has to actually remove the rows.
-- ---------------------------------------------------------------------

alter table public.history_entries enable row level security;

drop policy if exists "history_select_own" on public.history_entries;
create policy "history_select_own"
  on public.history_entries for select
  to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists "history_insert_own" on public.history_entries;
create policy "history_insert_own"
  on public.history_entries for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists "history_update_own" on public.history_entries;
create policy "history_update_own"
  on public.history_entries for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "history_delete_own" on public.history_entries;
create policy "history_delete_own"
  on public.history_entries for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- anon gets nothing; signed-out visitors keep using the calculator entirely
-- in memory, exactly as before
revoke all on public.history_entries from anon, authenticated;
grant select, insert, update, delete on public.history_entries to authenticated;
