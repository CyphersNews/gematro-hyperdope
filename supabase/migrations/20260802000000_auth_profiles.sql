-- =====================================================================
-- Profiles for Cyphers auth
--
-- Supabase owns auth.users (email, password hash, identities, sessions).
-- That table is not ours to extend, so application-level user data lives in
-- public.profiles with a 1:1 foreign key onto it. This is the separation
-- Supabase recommends: never write to auth.users directly.
--
-- Safe to re-run: every statement is guarded.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text,
  username          text,
  discord_id        text,
  discord_username  text,
  discord_avatar    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.profiles is
  'Application profile, one row per auth.users row. Never stores credentials.';

-- Case-insensitive uniqueness so "Joe" and "joe" cannot both be taken.
-- Partial, because username is optional and many rows will be null.
create unique index if not exists profiles_username_key
  on public.profiles (lower(username)) where username is not null;

-- One Discord account may only be attached to one profile. This is what stops
-- a second account being created for a Discord identity that is already linked.
create unique index if not exists profiles_discord_id_key
  on public.profiles (discord_id) where discord_id is not null;

create index if not exists profiles_email_idx on public.profiles (lower(email));

-- ---------------------------------------------------------------------
-- 2. updated_at maintenance
-- ---------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. Create / refresh the profile whenever a user signs up or signs in
--
-- security definer so it can write to public.profiles from the auth schema's
-- trigger context. search_path is pinned to defeat search-path hijacking, which
-- is the standard hardening for a security definer function.
--
-- Discord fields come out of raw_user_meta_data, which Supabase populates from
-- the OAuth provider. coalesce covers the different key names Discord and
-- Supabase have used over time.
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  is_discord boolean := coalesce(new.raw_app_meta_data ->> 'provider', '') = 'discord';
begin
  insert into public.profiles (id, email, discord_id, discord_username, discord_avatar)
  values (
    new.id,
    new.email,
    case when is_discord then coalesce(meta ->> 'provider_id', meta ->> 'sub') end,
    case when is_discord then coalesce(meta ->> 'custom_claims' , meta ->> 'full_name', meta ->> 'name', meta ->> 'user_name') end,
    case when is_discord then coalesce(meta ->> 'avatar_url', meta ->> 'picture') end
  )
  on conflict (id) do update set
    -- only fill blanks; never clobber a username the user chose themselves
    email            = coalesce(excluded.email, public.profiles.email),
    discord_id       = coalesce(excluded.discord_id, public.profiles.discord_id),
    discord_username = coalesce(excluded.discord_username, public.profiles.discord_username),
    discord_avatar   = coalesce(excluded.discord_avatar, public.profiles.discord_avatar),
    updated_at       = now();

  return new;
end;
$$;

-- fires on signup, and again on update so linking Discord later fills the row
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 4. Row Level Security
--
-- With RLS on and only these policies, the anon key can do nothing except act
-- on the signed-in user's own row. auth.uid() is read from the verified JWT by
-- Postgres, so it cannot be spoofed from the browser.
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;

-- read only your own profile
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using ( (select auth.uid()) = id );

-- update only your own profile, and you cannot move a row to another user
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );

-- Insert exists only as a fallback; the trigger above normally creates the row.
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check ( (select auth.uid()) = id );

-- No delete policy on purpose: profiles disappear via the cascade when the
-- auth.users row is deleted, so a client cannot orphan or remove one directly.

-- ---------------------------------------------------------------------
-- 5. Grants
--
-- RLS filters rows, grants decide which statements are even allowed. anon gets
-- nothing: a signed-out visitor has no business touching this table.
-- ---------------------------------------------------------------------

revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 6. Backfill any users that existed before this migration
-- ---------------------------------------------------------------------

insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;
