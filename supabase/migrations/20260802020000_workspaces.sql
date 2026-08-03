-- =====================================================================
-- Saved workspace
--
-- One row per user holding the calculator's own settings blob: enabled
-- ciphers, custom ciphers, colours, code rain style/speed/density and every
-- option. Exactly the string exportCiphersDB(true) already produces for
-- localStorage and for "Export Settings (JS)", so there is one format rather
-- than a second parallel one to keep in step.
--
-- Stored as text rather than parsed into columns on purpose: the calculator
-- owns that format and adds options regularly, and a column per option would
-- need a migration every time.
--
-- Safe to re-run.
-- =====================================================================

create table if not exists public.workspaces (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  settings    text not null,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  -- a full settings blob with every cipher is around 100-200 KB; this is a
  -- generous ceiling that still stops the column being used as free storage
  constraint workspaces_settings_size check (length(settings) <= 2000000)
);

comment on table public.workspaces is
  'Per-user calculator workspace, stored in the app''s own settings format.';

drop trigger if exists workspaces_touch_updated_at on public.workspaces;
create trigger workspaces_touch_updated_at
  before update on public.workspaces
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security
--
-- Same shape as the other tables. Delete is allowed so a user can reset their
-- workspace back to defaults.
-- ---------------------------------------------------------------------

alter table public.workspaces enable row level security;

drop policy if exists "workspaces_select_own" on public.workspaces;
create policy "workspaces_select_own"
  on public.workspaces for select
  to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists "workspaces_insert_own" on public.workspaces;
create policy "workspaces_insert_own"
  on public.workspaces for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists "workspaces_update_own" on public.workspaces;
create policy "workspaces_update_own"
  on public.workspaces for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "workspaces_delete_own" on public.workspaces;
create policy "workspaces_delete_own"
  on public.workspaces for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

revoke all on public.workspaces from anon, authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;
