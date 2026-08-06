-- =====================================================================
-- Friends: requests, friendships, discovery and privacy
--
-- One row per PAIR, not per direction. The pair is stored in a canonical
-- order - user_a is always the lesser uuid - and a unique index sits on
-- (user_a, user_b). That single decision is what makes every duplicate case
-- impossible in the database rather than in application code:
--
--   * A asks B twice          -> unique index rejects the second
--   * A asks B, B asks A      -> same canonical row, unique index rejects it
--   * A asks A                -> user_a < user_b cannot hold, check rejects it
--   * already friends, ask again -> same row again, unique index rejects it
--
-- No client and no future feature can get around that, because it is not a
-- rule anyone has to remember to apply.
--
-- Every state change goes through a security definer function rather than a
-- direct update. The rules ("only the addressee may accept", "only the
-- requester may cancel") then live in one place, and the client API is a set
-- of verbs that will not change shape when messaging or blocking is added.
--
-- Safe to re-run: every statement is guarded.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Privacy and presence on the profile
--
-- Defaults are deliberately open-but-not-exposed: a new member is findable
-- and can be asked, because a friends system where nobody can be found does
-- nothing, but nothing here reveals an email or anything they did privately.
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists friend_policy    text        not null default 'members',
  add column if not exists show_online      boolean     not null default true,
  add column if not exists show_last_active boolean     not null default true,
  add column if not exists show_mutuals     boolean     not null default true,
  add column if not exists public_profile   boolean     not null default true,
  add column if not exists last_active_at   timestamptz;

comment on column public.profiles.friend_policy is
  'Who may send a friend request: everyone | members | friends_of_friends | nobody.';
comment on column public.profiles.public_profile is
  'False hides the member from search and discovery, and blanks their profile.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_friend_policy_check'
  ) then
    alter table public.profiles
      add constraint profiles_friend_policy_check
      check (friend_policy in ('everyone', 'members', 'friends_of_friends', 'nobody'));
  end if;
end $$;

-- discovery sorts on these
create index if not exists profiles_created_idx on public.profiles (created_at desc);
create index if not exists profiles_last_active_idx on public.profiles (last_active_at desc nulls last);


-- ---------------------------------------------------------------------
-- 2. The friendships table
--
-- status carries 'blocked' from the start. Blocking is not in this release,
-- but adding a value to a check constraint later means rewriting the table's
-- constraint while rows exist; carrying it now costs nothing.
-- ---------------------------------------------------------------------

create table if not exists public.friendships (
  id            uuid primary key default gen_random_uuid(),
  user_a        uuid not null references auth.users (id) on delete cascade,
  user_b        uuid not null references auth.users (id) on delete cascade,
  requested_by  uuid not null references auth.users (id) on delete cascade,
  status        text not null default 'pending',
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,

  -- canonical ordering: this is what makes the pair unique in one direction
  constraint friendships_ordered check (user_a < user_b),
  constraint friendships_status check (status in ('pending', 'accepted', 'blocked')),
  constraint friendships_requester check (requested_by in (user_a, user_b))
);

comment on table public.friendships is
  'One row per pair of members, stored with user_a < user_b so a pair cannot be duplicated in either direction.';

create unique index if not exists friendships_pair_key
  on public.friendships (user_a, user_b);

-- "my friends" and "my requests" both read one side of the pair, so both sides
-- are indexed with the status alongside
create index if not exists friendships_a_idx on public.friendships (user_a, status);
create index if not exists friendships_b_idx on public.friendships (user_b, status);
create index if not exists friendships_pending_idx
  on public.friendships (requested_by, status) where status = 'pending';


-- ---------------------------------------------------------------------
-- 3. Row Level Security
--
-- Reads are limited to rows you are part of, so nobody can enumerate who is
-- friends with whom. Writes go through the functions below; there is no
-- insert or update policy at all, which means a client cannot forge a
-- friendship or accept on someone else's behalf even if it tries.
--
-- Delete is allowed to either party: removing a friend and declining a
-- request are the same operation on the row, and both people are entitled to
-- do it. The functions still exist so the client has one verb per intent.
-- ---------------------------------------------------------------------

alter table public.friendships enable row level security;

drop policy if exists "friendships_select_mine" on public.friendships;
create policy "friendships_select_mine"
  on public.friendships for select
  to authenticated
  using ( (select auth.uid()) in (user_a, user_b) );

drop policy if exists "friendships_delete_mine" on public.friendships;
create policy "friendships_delete_mine"
  on public.friendships for delete
  to authenticated
  using ( (select auth.uid()) in (user_a, user_b) );

revoke all on public.friendships from anon, authenticated;
grant select, delete on public.friendships to authenticated;


-- ---------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------

-- The canonical pair for two ids, so callers never have to remember the order.
create or replace function public.friend_pair(u1 uuid, u2 uuid)
returns table (lo uuid, hi uuid)
language sql
immutable
as $$
  select least(u1, u2), greatest(u1, u2);
$$;

-- Are these two accepted friends?
create or replace function public.are_friends(u1 uuid, u2 uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.user_a = least(u1, u2)
      and f.user_b = greatest(u1, u2)
      and f.status = 'accepted'
  );
$$;

-- How many friends the two of them share. Used for "3 mutual friends" and for
-- the friends_of_friends privacy rule.
create or replace function public.friend_mutual_count(viewer uuid, target uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select case when f.user_a = viewer then f.user_b else f.user_a end as friend
    from public.friendships f
    where f.status = 'accepted' and viewer in (f.user_a, f.user_b)
  ),
  theirs as (
    select case when f.user_a = target then f.user_b else f.user_a end as friend
    from public.friendships f
    where f.status = 'accepted' and target in (f.user_a, f.user_b)
  )
  select count(*)::int from mine join theirs using (friend);
$$;

-- Where a member stands relative to the caller, as one word the UI can switch
-- on: self | friends | sent | received | blocked | none
create or replace function public.friend_state(viewer uuid, target uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when viewer = target then 'self'
    else coalesce((
      select case
        when f.status = 'accepted' then 'friends'
        when f.status = 'blocked'  then 'blocked'
        when f.requested_by = viewer then 'sent'
        else 'received'
      end
      from public.friendships f
      where f.user_a = least(viewer, target)
        and f.user_b = greatest(viewer, target)
    ), 'none')
  end;
$$;

-- May the caller send this person a request, given that person's setting?
create or replace function public.friend_can_request(viewer uuid, target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case (select p.friend_policy from public.profiles p where p.id = target)
    when 'nobody' then false
    when 'friends_of_friends' then public.friend_mutual_count(viewer, target) > 0
    else true   -- 'everyone' and 'members' are the same while the site needs an account
  end;
$$;


-- ---------------------------------------------------------------------
-- 5. The verbs
--
-- Each returns the resulting state, so the client can re-render from the
-- answer without a second round trip.
-- ---------------------------------------------------------------------

create or replace function public.friend_request(target uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if target is null or target = me then raise exception 'You cannot add yourself'; end if;
  if not exists (select 1 from public.profiles where id = target) then
    raise exception 'No such member';
  end if;

  existing := public.friend_state(me, target);
  if existing <> 'none' then
    return existing; -- already friends, already asked, or asked by them
  end if;

  if not public.friend_can_request(me, target) then
    raise exception 'That member is not accepting friend requests';
  end if;

  insert into public.friendships (user_a, user_b, requested_by, status)
  values (least(me, target), greatest(me, target), me, 'pending')
  on conflict (user_a, user_b) do nothing;

  return public.friend_state(me, target);
end;
$$;

-- Accept or decline. Only the person who did NOT send it may answer it, which
-- is the rule that a plain update policy could not express cleanly.
create or replace function public.friend_respond(target uuid, accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  row public.friendships;
begin
  if me is null then raise exception 'Not signed in'; end if;

  select * into row from public.friendships
  where user_a = least(me, target) and user_b = greatest(me, target);

  if not found or row.status <> 'pending' then
    raise exception 'There is no request to answer';
  end if;
  if row.requested_by = me then
    raise exception 'You sent this request; cancel it instead';
  end if;

  if accept then
    update public.friendships
      set status = 'accepted', responded_at = now()
      where id = row.id;
  else
    delete from public.friendships where id = row.id;
  end if;

  return public.friend_state(me, target);
end;
$$;

-- Withdraw a request you sent.
create or replace function public.friend_cancel(target uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  delete from public.friendships
  where user_a = least(me, target) and user_b = greatest(me, target)
    and status = 'pending' and requested_by = me;
  return public.friend_state(me, target);
end;
$$;

-- Unfriend. Either party may; the row is the friendship itself.
create or replace function public.friend_remove(target uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  delete from public.friendships
  where user_a = least(me, target) and user_b = greatest(me, target)
    and status = 'accepted';
  return public.friend_state(me, target);
end;
$$;

-- Presence, in the cheapest form that is still honest: a timestamp the client
-- touches while the tab is open. "Online" is then a question about how recent
-- that is, which the UI decides, rather than a flag that gets stuck on when a
-- browser closes without warning.
create or replace function public.touch_last_active()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_active_at = now() where id = auth.uid();
$$;


-- ---------------------------------------------------------------------
-- 6. Reading: lists, search and discovery
--
-- All of these return the same shape - a member card plus the caller's
-- relationship to it - so the UI has one renderer rather than five.
-- ---------------------------------------------------------------------

-- the columns every list returns
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
    p.show_mutuals
  from public.profiles p;

comment on view public.member_cards is
  'Non-sensitive member identity for the friends UI. Email is never referenced.';

revoke all on public.member_cards from anon, authenticated;
grant select on public.member_cards to authenticated;

-- Search by username or display name. Case-insensitive, partial, and hidden
-- members are left out - except yourself, so you can always see how you look.
create or replace function public.member_search(q text, lim integer default 20)
returns table (
  id uuid, display_name text, username text, avatar text,
  joined_at timestamptz, last_active_at timestamptz,
  state text, mutuals integer
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.display_name, m.username, m.avatar, m.joined_at,
         case when m.show_online then m.last_active_at end,
         public.friend_state(auth.uid(), m.id),
         case when m.show_mutuals then public.friend_mutual_count(auth.uid(), m.id) else 0 end
  from public.member_cards m
  where (m.public_profile or m.id = auth.uid())
    and length(btrim(coalesce(q, ''))) > 0
    and (m.display_name ilike '%' || btrim(q) || '%'
         or coalesce(m.username, '') ilike '%' || btrim(q) || '%')
  order by
    -- a name that starts with what was typed beats one that merely contains it
    case when m.display_name ilike btrim(q) || '%' then 0 else 1 end,
    m.display_name
  limit least(coalesce(lim, 20), 50);
$$;

-- Your friends, with the sort chosen by the caller.
create or replace function public.friend_list(sort text default 'recent', lim integer default 200)
returns table (
  id uuid, display_name text, username text, avatar text,
  joined_at timestamptz, last_active_at timestamptz,
  since timestamptz, mutuals integer
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.display_name, m.username, m.avatar, m.joined_at,
         case when m.show_online then m.last_active_at end,
         coalesce(f.responded_at, f.created_at) as since,
         case when m.show_mutuals then public.friend_mutual_count(auth.uid(), m.id) else 0 end
  from public.friendships f
  join public.member_cards m
    on m.id = case when f.user_a = auth.uid() then f.user_b else f.user_a end
  where f.status = 'accepted' and auth.uid() in (f.user_a, f.user_b)
  order by
    case when sort = 'name' then lower(m.display_name) end asc,
    case when sort = 'online' then
      (case when m.show_online and m.last_active_at > now() - interval '5 minutes' then 0 else 1 end)
    end asc,
    case when sort = 'online' then m.last_active_at end desc nulls last,
    case when sort not in ('name') then coalesce(f.responded_at, f.created_at) end desc
  limit least(coalesce(lim, 200), 500);
$$;

-- Requests waiting on you, and requests you are waiting on.
create or replace function public.friend_requests(direction text default 'incoming')
returns table (
  id uuid, display_name text, username text, avatar text,
  joined_at timestamptz, asked_at timestamptz, mutuals integer
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.display_name, m.username, m.avatar, m.joined_at, f.created_at,
         case when m.show_mutuals then public.friend_mutual_count(auth.uid(), m.id) else 0 end
  from public.friendships f
  join public.member_cards m
    on m.id = case when f.user_a = auth.uid() then f.user_b else f.user_a end
  where f.status = 'pending'
    and auth.uid() in (f.user_a, f.user_b)
    and case when direction = 'outgoing'
             then f.requested_by = auth.uid()
             else f.requested_by <> auth.uid() end
  order by f.created_at desc;
$$;

-- The badge numbers, in one call.
create or replace function public.friend_counts()
returns table (friends integer, incoming integer, outgoing integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::int from public.friendships f
      where f.status = 'accepted' and auth.uid() in (f.user_a, f.user_b)),
    (select count(*)::int from public.friendships f
      where f.status = 'pending' and auth.uid() in (f.user_a, f.user_b)
        and f.requested_by <> auth.uid()),
    (select count(*)::int from public.friendships f
      where f.status = 'pending' and auth.uid() in (f.user_a, f.user_b)
        and f.requested_by = auth.uid());
$$;

-- Discovery. One function, one `kind`, so a new way of suggesting people is a
-- new branch here rather than a new endpoint and a new client method.
--
--   popular  - most published phrases
--   recent   - newly joined
--   active   - seen most recently
--   mutual   - friends of your friends, most shared first
--   similar  - members who publish in the same cyphers you do
--
-- Everyone you already know is filtered out of all of them, so discovery only
-- ever shows people you could actually add.
create or replace function public.member_discover(kind text default 'popular', lim integer default 12)
returns table (
  id uuid, display_name text, username text, avatar text,
  joined_at timestamptz, last_active_at timestamptz,
  state text, mutuals integer, score integer
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  known as ( -- anyone already connected to me, in either direction
    select case when f.user_a = (select uid from me) then f.user_b else f.user_a end as id
    from public.friendships f
    where (select uid from me) in (f.user_a, f.user_b)
  ),
  my_ciphers as (
    select distinct s.cipher
    from public.phrase_submissions s
    where s.user_id = (select uid from me) and s.cipher is not null
  ),
  base as (
    select m.*,
      case kind
        when 'popular' then (
          select count(*)::int from public.phrase_submissions s where s.user_id = m.id)
        when 'similar' then (
          select count(distinct s.cipher)::int
          from public.phrase_submissions s
          where s.user_id = m.id and s.cipher in (select cipher from my_ciphers))
        when 'mutual' then public.friend_mutual_count((select uid from me), m.id)
        else 0
      end as score
    from public.member_cards m
    where m.public_profile
      and m.id <> (select uid from me)
      and m.id not in (select id from known)
  )
  select b.id, b.display_name, b.username, b.avatar, b.joined_at,
         case when b.show_online then b.last_active_at end,
         public.friend_state((select uid from me), b.id),
         case when b.show_mutuals then public.friend_mutual_count((select uid from me), b.id) else 0 end,
         b.score
  from base b
  where case kind
          when 'popular' then b.score > 0
          when 'similar' then b.score > 0
          when 'mutual'  then b.score > 0
          when 'active'  then b.last_active_at is not null
          else true
        end
  order by
    case when kind = 'recent' then b.joined_at end desc,
    case when kind = 'active' then b.last_active_at end desc,
    case when kind in ('popular', 'similar', 'mutual') then b.score end desc,
    b.joined_at desc
  limit least(coalesce(lim, 12), 50);
$$;

-- A member's public profile. Returns nothing when they have turned it off,
-- which the UI reads as "this profile is private" rather than "no such user".
create or replace function public.member_profile(target uuid)
returns table (
  id uuid, display_name text, username text, avatar text,
  joined_at timestamptz, last_active_at timestamptz,
  state text, mutuals integer,
  submissions integer, rank integer, ciphers_used integer
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
           where s2.user_id = m.id and s2.cipher is not null)
  from public.member_cards m
  left join ranked r on r.user_id = m.id
  where m.id = target
    and (m.public_profile or m.id = auth.uid());
$$;


-- ---------------------------------------------------------------------
-- 7. Grants
--
-- Every function is security definer, so execute is the whole permission.
-- anon gets none of them: none of this is visible to a signed-out visitor.
-- ---------------------------------------------------------------------

revoke all on function public.friend_request(uuid) from anon, authenticated;
revoke all on function public.friend_respond(uuid, boolean) from anon, authenticated;
revoke all on function public.friend_cancel(uuid) from anon, authenticated;
revoke all on function public.friend_remove(uuid) from anon, authenticated;
revoke all on function public.touch_last_active() from anon, authenticated;
revoke all on function public.member_search(text, integer) from anon, authenticated;
revoke all on function public.friend_list(text, integer) from anon, authenticated;
revoke all on function public.friend_requests(text) from anon, authenticated;
revoke all on function public.friend_counts() from anon, authenticated;
revoke all on function public.member_discover(text, integer) from anon, authenticated;
revoke all on function public.member_profile(uuid) from anon, authenticated;
revoke all on function public.friend_mutual_count(uuid, uuid) from anon, authenticated;
revoke all on function public.friend_state(uuid, uuid) from anon, authenticated;
revoke all on function public.are_friends(uuid, uuid) from anon, authenticated;
revoke all on function public.friend_can_request(uuid, uuid) from anon, authenticated;

grant execute on function public.friend_request(uuid) to authenticated;
grant execute on function public.friend_respond(uuid, boolean) to authenticated;
grant execute on function public.friend_cancel(uuid) to authenticated;
grant execute on function public.friend_remove(uuid) to authenticated;
grant execute on function public.touch_last_active() to authenticated;
grant execute on function public.member_search(text, integer) to authenticated;
grant execute on function public.friend_list(text, integer) to authenticated;
grant execute on function public.friend_requests(text) to authenticated;
grant execute on function public.friend_counts() to authenticated;
grant execute on function public.member_discover(text, integer) to authenticated;
grant execute on function public.member_profile(uuid) to authenticated;
grant execute on function public.are_friends(uuid, uuid) to authenticated;


-- =====================================================================
-- Notes for what comes next
--
-- Direct messages / group chats
--   Add public.conversations (id, kind) and public.conversation_members
--   (conversation_id, user_id), then public.messages (conversation_id,
--   sender_id, body, created_at). A 1:1 conversation's read policy is
--   "are_friends(sender, me)" or membership of the conversation - are_friends()
--   is already here and already security definer.
--
-- Friend activity feed
--   A public.activity table (user_id, kind, payload jsonb, created_at) read
--   through a policy of "the actor is an accepted friend of auth.uid()".
--   friend_list() shows the shape that query takes.
--
-- Shared collections / private groups
--   Both are a group table plus a membership table, the same pattern as
--   conversations. Nothing here assumes a relationship is only ever a pair.
--
-- Friends-only leaderboards and competitions
--   The existing leaderboard view, joined against friend_list(). No schema
--   change needed at all.
--
-- Blocking
--   status = 'blocked' is already legal. It needs a decision this release did
--   not have to make: whether a block is symmetric or directional. If
--   directional, add blocked_by uuid alongside requested_by rather than
--   overloading it.
--
-- Reporting
--   A separate insert-only table, the same shape as the contact inbox: insert
--   policy for authenticated, no select policy at all.
-- =====================================================================
