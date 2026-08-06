-- =====================================================================
-- Public profile: roles, favourite cyphers, and the stats that go with them
--
-- NOTE FOR ANYONE ADDING A PROFILE COLUMN LATER
--
-- profiles no longer has a table-wide UPDATE grant - the admin migration
-- replaced it with a grant on a named list of columns, because a table-wide
-- one let members set their own is_admin. Any new column a member is meant to
-- edit has to be added to that list or it will silently fail to save. Two are
-- added below, and the grant is restated in full rather than appended to, so
-- the list is readable in one place.
--
-- WHY ROLES ARE A LOOKUP TABLE AND NOT FREE TEXT
--
-- These appear on a public profile. Free text there is a slur waiting to
-- happen, and a moderation problem that the chat filter would not see because
-- it never passes through chat. A closed set validated by a trigger means the
-- worst a member can do is claim to be a Tarot Reader.
--
-- Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The roles a member can claim
--
-- A table rather than a check constraint so adding one is an INSERT. The UI
-- reads this to build its list, so a new row appears in the picker with no
-- client change at all.
-- ---------------------------------------------------------------------

create table if not exists public.profile_role_options (
  key    text primary key,
  label  text not null,
  emoji  text not null default '',
  sort   integer not null default 100,
  active boolean not null default true
);

insert into public.profile_role_options (key, label, emoji, sort) values
  ('cryptographer',  'Cryptographer',        '🔐', 10),
  ('decoder',        'Decoder',              '🕵️', 20),
  ('encoder',        'Encoder',              '🔣', 30),
  ('ccru',           'CCRU Scholar',         '📖', 40),
  ('conspiracy',     'Conspiracy Researcher','🛸', 50),
  ('astrology',      'Astrology Enthusiast', '♈', 60),
  ('tarot',          'Tarot Reader',         '🃏', 70),
  ('fortune',        'Fortune Teller',       '🔮', 80),
  ('numerologist',   'Numerologist',         '🔢', 90),
  ('linguist',       'Linguist',             '🗣️', 100),
  ('historian',      'Historian',            '🏛️', 110),
  ('mathematician',  'Mathematician',        '📐', 120),
  ('researcher',     'Researcher',           '🔎', 130),
  ('writer',         'Writer',               '✍️', 140),
  ('youtuber',       'YouTuber',             '🎥', 150),
  ('filmmaker',      'Filmmaker',            '🎬', 160),
  ('podcaster',      'Podcaster',            '🎙️', 170),
  ('artist',         'Artist',               '🎨', 180),
  ('musician',       'Musician',             '🎵', 190),
  ('developer',      'Developer',            '💻', 200),
  ('entrepreneur',   'Entrepreneur',         '💼', 210),
  ('teacher',        'Teacher',              '🧑‍🏫', 220),
  ('student',        'Student',              '🎓', 230),
  ('newcomer',       'Just Curious',         '👋', 240)
on conflict (key) do update set
  label = excluded.label, emoji = excluded.emoji, sort = excluded.sort;

alter table public.profile_role_options enable row level security;

drop policy if exists "role_options_read" on public.profile_role_options;
create policy "role_options_read"
  on public.profile_role_options for select to authenticated
  using ( active );

revoke all on public.profile_role_options from anon, authenticated;
grant select on public.profile_role_options to authenticated;


-- ---------------------------------------------------------------------
-- 2. The columns themselves
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists roles             text[] not null default '{}',
  add column if not exists fav_ciphers       text[] not null default '{}',
  add column if not exists show_friend_count boolean not null default true;

comment on column public.profiles.fav_ciphers is
  'Up to four cypher names, shown on the public profile in their own colours. Names rather than ids because custom cyphers only exist in the workspace blob.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_roles_len') then
    alter table public.profiles add constraint profiles_roles_len
      check (coalesce(array_length(roles, 1), 0) <= 5);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_fav_len') then
    alter table public.profiles add constraint profiles_fav_len
      check (coalesce(array_length(fav_ciphers, 1), 0) <= 4);
  end if;
end $$;

-- Roles must be known keys; cypher names are capped rather than closed,
-- because custom cyphers are real and only the member knows their names.
create or replace function public.profiles_guard_public_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare bad text;
begin
  if new.roles is not null and array_length(new.roles, 1) > 0 then
    select r into bad from unnest(new.roles) r
     where r not in (select o.key from public.profile_role_options o where o.active)
     limit 1;
    if bad is not null then
      raise exception 'Unknown role: %', bad;
    end if;
  end if;

  if new.fav_ciphers is not null and array_length(new.fav_ciphers, 1) > 0 then
    select c into bad from unnest(new.fav_ciphers) c
     where length(c) > 60 or btrim(c) = ''
     limit 1;
    if bad is not null then
      raise exception 'That is not a cypher name';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_public_fields on public.profiles;
create trigger profiles_guard_public_fields
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_public_fields();


-- ---------------------------------------------------------------------
-- 3. The grant, restated in full
--
-- Appending would have left the real list split across two migrations. This is
-- the whole of what a member may change about their own row.
-- ---------------------------------------------------------------------

revoke update on public.profiles from authenticated;

grant update (
  username,
  avatar_url,
  setup_done,
  friend_policy,
  show_online,
  show_last_active,
  show_mutuals,
  show_friend_count,
  public_profile,
  roles,
  fav_ciphers
) on public.profiles to authenticated;


-- ---------------------------------------------------------------------
-- 4. member_cards picks up the new fields
-- ---------------------------------------------------------------------

create or replace view public.member_cards as
  select
    p.id,
    coalesce(p.username, p.discord_username, 'Anonymous') as display_name,
    p.username,
    coalesce(p.avatar_url, p.discord_avatar)              as avatar,
    p.created_at                                          as joined_at,
    p.public_profile,
    p.friend_policy,
    case when p.show_last_active then p.last_active_at end as last_active_at,
    p.show_online,
    p.show_mutuals,
    p.roles,
    p.fav_ciphers,
    p.show_friend_count
  from public.profiles p;

revoke all on public.member_cards from anon, authenticated;
grant select on public.member_cards to authenticated;


-- ---------------------------------------------------------------------
-- 5. member_profile, rebuilt
--
-- Dropped and recreated rather than replaced: adding columns to a RETURNS
-- TABLE changes the return type, which create or replace refuses. The grant
-- goes with it and has to be restated.
-- ---------------------------------------------------------------------

drop function if exists public.member_profile(uuid);

create or replace function public.member_profile(target uuid)
returns table (
  id uuid, display_name text, username text, avatar text,
  joined_at timestamptz, last_active_at timestamptz,
  state text, mutuals integer,
  submissions integer, rank integer, ciphers_used integer,
  roles text[], fav_ciphers text[], friends integer, is_admin boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select s.user_id, count(*)::int as n,
           rank() over (order by count(*) desc)::int as rnk
    from public.phrase_submissions s
    group by s.user_id
  )
  select m.id, m.display_name, m.username, m.avatar, m.joined_at,
         case when m.show_online then m.last_active_at end,
         public.friend_state(auth.uid(), m.id),
         case when m.show_mutuals then public.friend_mutual_count(auth.uid(), m.id) else 0 end,
         coalesce(r.n, 0),
         r.rnk,
         (select count(distinct s2.cipher)::int
            from public.phrase_submissions s2
           where s2.user_id = m.id and s2.cipher is not null),
         m.roles,
         m.fav_ciphers,
         case when m.show_friend_count then (
           select count(*)::int from public.friendships f
            where f.status = 'accepted' and m.id in (f.user_a, f.user_b)
         ) else null end,
         coalesce((select p2.is_admin from public.profiles p2 where p2.id = m.id), false)
  from public.member_cards m
  left join ranked r on r.user_id = m.id
  where m.id = target
    and (m.public_profile or m.id = auth.uid());
$$;

revoke all on function public.member_profile(uuid) from anon, authenticated;
grant execute on function public.member_profile(uuid) to authenticated;
