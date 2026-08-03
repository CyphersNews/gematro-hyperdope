-- =====================================================================
-- Named presets
--
-- A workspace is the one setup you are working in right now. A preset is a
-- setup you keep and switch back to: "Base 4 only", "Hebrew research",
-- "CCRU red rain". Same settings blob as public.workspaces, and the same
-- format exportCiphersDB(true) produces, so loading a preset reuses the
-- existing import path rather than a second parallel one.
--
-- Many rows per user rather than one, each with a name.
--
-- Safe to re-run.
-- =====================================================================

create table if not exists public.presets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  settings    text not null,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  constraint presets_name_not_blank check (length(btrim(name)) > 0),
  constraint presets_name_len check (length(name) <= 60),
  -- same ceiling as workspaces: a full blob with every cipher is 100-200 KB
  constraint presets_settings_size check (length(settings) <= 2000000)
);

comment on table public.presets is
  'Named calculator setups a user can switch between, in the app''s own settings format.';

-- Names are how presets are told apart in the UI, so they are unique per user
-- and case-insensitively so - "Hebrew" and "hebrew" would be indistinguishable
-- in a list. Saving over an existing name is an update, not a second row.
create unique index if not exists presets_user_name_key
  on public.presets (user_id, lower(btrim(name)));

create index if not exists presets_user_idx on public.presets (user_id);

drop trigger if exists presets_touch_updated_at on public.presets;
create trigger presets_touch_updated_at
  before update on public.presets
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security
--
-- Presets are private: unlike submissions, nothing here is meant to be seen
-- by anyone else, so every policy is scoped to the owner.
-- ---------------------------------------------------------------------

alter table public.presets enable row level security;

drop policy if exists "presets_select_own" on public.presets;
create policy "presets_select_own"
  on public.presets for select
  to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists "presets_insert_own" on public.presets;
create policy "presets_insert_own"
  on public.presets for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists "presets_update_own" on public.presets;
create policy "presets_update_own"
  on public.presets for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "presets_delete_own" on public.presets;
create policy "presets_delete_own"
  on public.presets for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

revoke all on public.presets from anon, authenticated;
grant select, insert, update, delete on public.presets to authenticated;
