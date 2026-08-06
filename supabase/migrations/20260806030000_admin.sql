-- =====================================================================
-- Admin panel: roles, moderation, user management and an audit trail
--
-- THE FIRST THING THIS MIGRATION DOES IS CLOSE A HOLE IT WOULD OTHERWISE OPEN
--
-- profiles was granted UPDATE at the table level, and its policy only checks
-- which ROW you are touching, not which COLUMN. Adding an is_admin column to
-- that table without changing anything else would mean any signed-in member
-- could run:
--
--     update profiles set is_admin = true where id = <their own id>
--
-- ...and the policy would allow it, because it is their own row. So the
-- table-wide grant is revoked and replaced with a grant on exactly the columns
-- a member is meant to edit. A trigger backs that up, so a future policy
-- mistake cannot reopen it.
--
-- EVERYTHING IS ENFORCED IN THE DATABASE
--
-- There are no admin-only tables that the client is trusted to stay out of.
-- Every privileged read and write is a security definer function whose first
-- act is admin_require(), which raises if the caller is not an admin. Hiding
-- the panel in the UI is a convenience; it is not the control.
--
-- Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Role and status columns
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_admin       boolean not null default false,
  add column if not exists status         text    not null default 'active',
  add column if not exists status_reason  text,
  add column if not exists status_until   timestamptz,
  add column if not exists status_set_at  timestamptz,
  add column if not exists status_set_by  uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_status_check') then
    alter table public.profiles add constraint profiles_status_check
      check (status in ('active', 'suspended', 'banned'));
  end if;
end $$;

create index if not exists profiles_is_admin_idx on public.profiles (is_admin) where is_admin;
create index if not exists profiles_status_idx on public.profiles (status) where status <> 'active';


-- ---------------------------------------------------------------------
-- 2. Close the privilege-escalation hole
--
-- Column-level grants. A member may change how they look and who may contact
-- them, and nothing else. is_admin, status and email are simply not in the
-- list, so an update naming them is refused by Postgres before any policy is
-- consulted.
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
  public_profile
) on public.profiles to authenticated;

-- Defence in depth: if a later migration re-grants the whole table by accident,
-- this still refuses. Only an admin may change a role or a status, and only
-- through the functions below, which run as the definer and set the flag.
create or replace function public.profiles_guard_privileged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_admin is distinct from old.is_admin
     or new.status is distinct from old.status
     or new.email is distinct from old.email
  then
    -- the functions in this file set this before writing; nothing else does
    if coalesce(current_setting('app.admin_action', true), '') <> 'on' then
      raise exception 'Roles and account status can only be changed by an administrator';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
  before update on public.profiles
  for each row execute function public.profiles_guard_privileged();


-- ---------------------------------------------------------------------
-- 3. Who is an admin
--
-- The first one is bootstrapped by email here. After that admins are made by
-- admins, so this block never needs editing again - and it is written to be
-- harmless if that address has not signed up yet.
-- ---------------------------------------------------------------------

do $$
declare bootstrap text := 'joehenderson196@gmail.com';
begin
  perform set_config('app.admin_action', 'on', true);
  update public.profiles p set is_admin = true
   where lower(p.email) = lower(bootstrap) and not p.is_admin;
  perform set_config('app.admin_action', '', true);
end $$;

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = uid), false);
$$;

-- Raises rather than returning false, so a function that forgets to check the
-- result still fails closed.
create or replace function public.admin_require()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.is_admin(me) then raise exception 'Administrators only'; end if;
  return me;
end;
$$;

-- Who the admins are is not a secret - it is a staff list, and the badge has
-- to be drawable wherever a name appears. Only the ids, nothing else.
create or replace function public.admin_list()
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.profiles p where p.is_admin;
$$;


-- ---------------------------------------------------------------------
-- 4. Audit log
--
-- Written by the functions below, never by a client. No select policy: it is
-- read through admin_audit_list(), which checks first.
-- ---------------------------------------------------------------------

create table if not exists public.admin_audit (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references auth.users (id) on delete set null,
  admin_name  text,
  action      text not null,
  target_id   uuid,
  target_name text,
  detail      jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);
create index if not exists admin_audit_target_idx on public.admin_audit (target_id, created_at desc);

alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;

-- The names are copied in rather than joined on later: an audit line has to
-- still read correctly after the account it refers to has been deleted, which
-- is exactly the case somebody will need it for.
create or replace function public.admin_log(action text, target uuid, detail jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  ip text;
begin
  -- PostgREST forwards the caller's headers; inet_client_addr() would only
  -- give the connection pooler
  begin
    ip := split_part(coalesce(
      current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''), ',', 1);
  exception when others then ip := null;
  end;

  insert into public.admin_audit (admin_id, admin_name, action, target_id, target_name, detail, ip)
  values (
    me,
    (select coalesce(p.username, p.email, 'admin') from public.profiles p where p.id = me),
    action,
    target,
    (select coalesce(p.username, p.email) from public.profiles p where p.id = target),
    detail,
    nullif(btrim(coalesce(ip, '')), '')
  );
end;
$$;


-- ---------------------------------------------------------------------
-- 5. Reports: what a report is now
--
-- The existing table recorded who reported whom. A moderator needs the message
-- and the conversation as well, or "they were rude to me" is unreviewable.
-- ---------------------------------------------------------------------

alter table public.reports
  add column if not exists message_id      uuid references public.messages (id) on delete set null,
  add column if not exists conversation_id uuid references public.conversations (id) on delete set null,
  add column if not exists message_body    text,
  add column if not exists status          text not null default 'open',
  add column if not exists handled_by      uuid references auth.users (id) on delete set null,
  add column if not exists handled_at      timestamptz,
  add column if not exists admin_note      text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reports_status_check') then
    alter table public.reports add constraint reports_status_check
      check (status in ('open', 'reviewing', 'dismissed', 'actioned'));
  end if;
end $$;

create index if not exists reports_status_idx on public.reports (status, created_at desc);

comment on column public.reports.message_body is
  'The reported message copied at report time. Kept because a sender can delete the original, and a report about a message that no longer exists cannot be judged.';


-- ---------------------------------------------------------------------
-- 6. Suspended and banned accounts cannot act
--
-- Enforced in the functions that write, not in the UI. A banned member holding
-- a valid token can still read what RLS allows them to; they cannot say,
-- publish or befriend anything.
-- ---------------------------------------------------------------------

create or replace function public.account_active(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.status = 'active'
        or (p.status = 'suspended' and p.status_until is not null and p.status_until < now())
    from public.profiles p where p.id = uid
  ), false);
$$;

-- A suspension with an end date lapses on its own rather than needing an admin
-- to remember. Called by the write paths.
create or replace function public.account_check(uid uuid default auth.uid())
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare st text; until timestamptz;
begin
  select p.status, p.status_until into st, until from public.profiles p where p.id = uid;
  if st = 'banned' then
    raise exception 'This account is banned';
  elsif st = 'suspended' and (until is null or until > now()) then
    if until is null then
      raise exception 'This account is suspended';
    else
      raise exception 'This account is suspended until %', to_char(until, 'DD Mon YYYY HH24:MI');
    end if;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 7. Admin reads
--
-- Every column in these bodies is qualified. The names in a PL/pgSQL RETURNS
-- TABLE are variables for the whole body, and an unqualified column that
-- happens to match one fails at call time rather than at create time.
-- ---------------------------------------------------------------------

create or replace function public.admin_stats()
returns table (
  users_total integer, users_online integer, users_new_today integer,
  reports_total integer, reports_open integer,
  users_banned integer, users_suspended integer, admins integer,
  messages_today integer, rejections_today integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::int from public.profiles),
    (select count(*)::int from public.profiles p
      where p.last_active_at > now() - interval '5 minutes'),
    (select count(*)::int from public.profiles p where p.created_at >= date_trunc('day', now())),
    (select count(*)::int from public.reports),
    (select count(*)::int from public.reports r where r.status in ('open', 'reviewing')),
    (select count(*)::int from public.profiles p where p.status = 'banned'),
    (select count(*)::int from public.profiles p where p.status = 'suspended'),
    (select count(*)::int from public.profiles p where p.is_admin),
    (select count(*)::int from public.messages m where m.created_at >= date_trunc('day', now())),
    (select count(*)::int from public.moderation_events e where e.created_at >= date_trunc('day', now()))
  where public.admin_require() is not null;
$$;

create or replace function public.admin_users(
  q text default null, sort text default 'recent',
  status_filter text default null, lim integer default 50, off integer default 0)
returns table (
  id uuid, username text, email text, avatar text,
  joined_at timestamptz, last_active_at timestamptz,
  is_admin boolean, status text, status_reason text, status_until timestamptz,
  submissions integer, reports_against integer
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         coalesce(p.username, p.discord_username),
         p.email,
         coalesce(p.avatar_url, p.discord_avatar),
         p.created_at,
         p.last_active_at,
         p.is_admin,
         p.status,
         p.status_reason,
         p.status_until,
         (select count(*)::int from public.phrase_submissions s where s.user_id = p.id),
         (select count(*)::int from public.reports r where r.reported_id = p.id)
  from public.profiles p
  where public.admin_require() is not null
    and (q is null or btrim(q) = ''
         or coalesce(p.username, '') ilike '%' || btrim(q) || '%'
         or coalesce(p.email, '')    ilike '%' || btrim(q) || '%'
         or coalesce(p.discord_username, '') ilike '%' || btrim(q) || '%')
    and (status_filter is null or status_filter = 'all' or p.status = status_filter)
  order by
    case when sort = 'name'   then lower(coalesce(p.username, p.email)) end asc,
    case when sort = 'active' then p.last_active_at end desc nulls last,
    case when sort = 'oldest' then p.created_at end asc,
    case when sort not in ('name', 'active', 'oldest') then p.created_at end desc
  limit least(coalesce(lim, 50), 200) offset greatest(coalesce(off, 0), 0);
$$;

create or replace function public.admin_online(window_minutes integer default 5)
returns table (id uuid, username text, avatar text, last_active_at timestamptz, is_admin boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, coalesce(p.username, p.discord_username, 'Member'),
         coalesce(p.avatar_url, p.discord_avatar), p.last_active_at, p.is_admin
  from public.profiles p
  where public.admin_require() is not null
    and p.last_active_at > now() - make_interval(mins => greatest(coalesce(window_minutes, 5), 1))
  order by p.last_active_at desc;
$$;

create or replace function public.admin_reports(
  status_filter text default null, sort text default 'newest', lim integer default 100)
returns table (
  id uuid, created_at timestamptz, status text,
  reporter_id uuid, reporter_name text,
  reported_id uuid, reported_name text,
  reason text, detail text,
  message_id uuid, message_body text, conversation_id uuid,
  handled_by_name text, handled_at timestamptz, admin_note text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.created_at, r.status,
         r.reporter_id,
         (select coalesce(pr.username, pr.email, 'Member') from public.profiles pr where pr.id = r.reporter_id),
         r.reported_id,
         (select coalesce(pd.username, pd.email, 'Member') from public.profiles pd where pd.id = r.reported_id),
         r.reason, r.detail,
         r.message_id, r.message_body, r.conversation_id,
         (select coalesce(ph.username, ph.email) from public.profiles ph where ph.id = r.handled_by),
         r.handled_at, r.admin_note
  from public.reports r
  where public.admin_require() is not null
    and (status_filter is null or status_filter = 'all' or r.status = status_filter)
  order by
    case when sort = 'oldest' then r.created_at end asc,
    case when sort <> 'oldest' then r.created_at end desc
  limit least(coalesce(lim, 100), 300);
$$;

-- The conversation around a reported message. Without this a moderator is
-- judging one line with no idea what it answered.
create or replace function public.admin_report_context(report uuid, span integer default 15)
returns table (
  id uuid, sender_id uuid, sender_name text, body text,
  created_at timestamptz, is_reported boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with r as (select * from public.reports rr where rr.id = report),
  conv as (
    select coalesce(
      (select rc.conversation_id from r rc),
      (select m.conversation_id from public.messages m where m.id = (select rm.message_id from r rm))
    ) as cid,
    (select rt.created_at from r rt) as at,
    (select rmi.message_id from r rmi) as mid
  )
  select m.id, m.sender_id,
         (select coalesce(p.username, p.email, 'Member') from public.profiles p where p.id = m.sender_id),
         m.body, m.created_at,
         (m.id = (select c.mid from conv c))
  from public.messages m
  where public.admin_require() is not null
    and m.conversation_id = (select c.cid from conv c)
    and m.created_at between (select c.at from conv c) - interval '2 hours'
                         and (select c.at from conv c) + interval '30 minutes'
  order by m.created_at asc
  limit least(coalesce(span, 15) * 4, 200);
$$;

create or replace function public.admin_audit_list(lim integer default 100)
returns table (
  id uuid, created_at timestamptz, admin_name text, action text,
  target_name text, detail jsonb, ip text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.created_at, a.admin_name, a.action, a.target_name, a.detail, a.ip
  from public.admin_audit a
  where public.admin_require() is not null
  order by a.created_at desc
  limit least(coalesce(lim, 100), 500);
$$;


-- ---------------------------------------------------------------------
-- 8. Admin writes
--
-- Each one checks, acts, logs. The guards that stop an admin locking everyone
-- out - including themselves - are here rather than in the panel, because the
-- panel is not what the rule is protecting against.
-- ---------------------------------------------------------------------

create or replace function public.admin_set_status(
  target uuid, new_status text, reason text default null, until timestamptz default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare me uuid := public.admin_require();
begin
  if new_status not in ('active', 'suspended', 'banned') then
    raise exception 'Unknown status';
  end if;
  if target = me and new_status <> 'active' then
    raise exception 'You cannot suspend or ban yourself';
  end if;
  if new_status <> 'active' and public.is_admin(target) then
    raise exception 'Remove their administrator rights first';
  end if;

  perform set_config('app.admin_action', 'on', true);
  update public.profiles p
     set status = new_status,
         status_reason = reason,
         status_until = case when new_status = 'suspended' then until else null end,
         status_set_at = now(),
         status_set_by = me
   where p.id = target;
  perform set_config('app.admin_action', '', true);

  -- A real ban stops them signing in again, not just acting. banned_until is
  -- the column Supabase's own admin API sets. Wrapped, because if a future
  -- Supabase release moves it the app-level block above still holds.
  begin
    if new_status = 'banned' then
      update auth.users u set banned_until = 'infinity'::timestamptz where u.id = target;
    else
      update auth.users u set banned_until = null where u.id = target;
    end if;
  exception when others then
    null;
  end;

  perform public.admin_log('status:' || new_status, target,
    jsonb_build_object('reason', reason, 'until', until));
  return new_status;
end;
$$;

create or replace function public.admin_set_admin(target uuid, make_admin boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.admin_require();
  others integer;
begin
  if not make_admin then
    select count(*)::int into others from public.profiles p where p.is_admin and p.id <> target;
    if others = 0 then
      raise exception 'There would be no administrators left';
    end if;
  end if;
  if make_admin and not public.account_active(target) then
    raise exception 'That account is suspended or banned';
  end if;

  perform set_config('app.admin_action', 'on', true);
  update public.profiles p set is_admin = make_admin where p.id = target;
  perform set_config('app.admin_action', '', true);

  perform public.admin_log(case when make_admin then 'admin:grant' else 'admin:revoke' end, target, null);
  return make_admin;
end;
$$;

create or replace function public.admin_delete_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.admin_require();
  who text;
begin
  if target = me then
    raise exception 'Use your own account settings to delete your account';
  end if;
  if public.is_admin(target) then
    raise exception 'Remove their administrator rights first';
  end if;

  select coalesce(p.username, p.email) into who from public.profiles p where p.id = target;
  -- logged before the delete: afterwards there is no name left to record
  perform public.admin_log('user:delete', target, jsonb_build_object('name', who));
  delete from auth.users u where u.id = target; -- everything else cascades
end;
$$;

create or replace function public.admin_report_status(report uuid, new_status text, note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare me uuid := public.admin_require();
begin
  if new_status not in ('open', 'reviewing', 'dismissed', 'actioned') then
    raise exception 'Unknown status';
  end if;
  update public.reports r
     set status = new_status,
         handled_by = me,
         handled_at = now(),
         admin_note = coalesce(note, r.admin_note)
   where r.id = report;
  if not found then raise exception 'No such report'; end if;

  perform public.admin_log('report:' || new_status, null, jsonb_build_object('report', report, 'note', note));
  return new_status;
end;
$$;


-- ---------------------------------------------------------------------
-- 9. Reporting a message, rather than a person in the abstract
-- ---------------------------------------------------------------------

create or replace function public.member_report(
  target uuid, reason text, detail text default null, message uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  msg public.messages;
begin
  if me is null or target = me then raise exception 'Cannot report yourself'; end if;
  if exists (select 1 from public.reports r
              where r.reporter_id = me and r.reported_id = target
                and r.created_at > now() - interval '1 hour') then
    raise exception 'You have already reported this member recently';
  end if;

  if message is not null then
    select m.* into msg from public.messages m
     where m.id = message
       and exists (select 1 from public.conversation_members cm
                    where cm.conversation_id = m.conversation_id and cm.user_id = me);
    if not found then raise exception 'That message is not one you can see'; end if;
  end if;

  insert into public.reports (reporter_id, reported_id, reason, detail,
                              message_id, conversation_id, message_body)
  values (me, target, reason, detail, msg.id, msg.conversation_id, msg.body);
end;
$$;


-- ---------------------------------------------------------------------
-- 10. Status enforcement on the existing write paths
-- ---------------------------------------------------------------------

create or replace function public.chat_send(target uuid, body text)
returns table (id uuid, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare cfg public.mod_settings;
begin
  perform public.account_check(auth.uid());
  select s.* into cfg from public.mod_settings s where s.id;
  if cfg.require_ai then
    raise exception 'Messages must go through moderation';
  end if;
  return query select * from public.chat_send_core(auth.uid(), target, body);
end;
$$;

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
  perform public.account_check(me);
  if target is null or target = me then raise exception 'You cannot add yourself'; end if;
  if not exists (select 1 from public.profiles p where p.id = target) then
    raise exception 'No such member';
  end if;

  existing := public.friend_state(me, target);
  if existing <> 'none' then return existing; end if;

  if not public.friend_can_request(me, target) then
    raise exception 'That member is not accepting friend requests';
  end if;

  insert into public.friendships (user_a, user_b, requested_by, status)
  values (least(me, target), greatest(me, target), me, 'pending')
  on conflict (user_a, user_b) do nothing;

  return public.friend_state(me, target);
end;
$$;

-- publishing is a write too
drop policy if exists "submissions_insert_own" on public.phrase_submissions;
create policy "submissions_insert_own"
  on public.phrase_submissions for insert
  to authenticated
  with check ( (select auth.uid()) = user_id and public.account_active((select auth.uid())) );


-- ---------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------

revoke all on function public.admin_require() from anon, authenticated;
revoke all on function public.admin_log(text, uuid, jsonb) from anon, authenticated;
revoke all on function public.profiles_guard_privileged() from anon, authenticated;

grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.admin_list() to authenticated;
grant execute on function public.account_active(uuid) to authenticated;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.admin_users(text, text, text, integer, integer) to authenticated;
grant execute on function public.admin_online(integer) to authenticated;
grant execute on function public.admin_reports(text, text, integer) to authenticated;
grant execute on function public.admin_report_context(uuid, integer) to authenticated;
grant execute on function public.admin_audit_list(integer) to authenticated;
grant execute on function public.admin_set_status(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.admin_report_status(uuid, text, text) to authenticated;
grant execute on function public.member_report(uuid, text, text, uuid) to authenticated;

-- Granting execute to `authenticated` is not the permission. Every one of the
-- admin_* functions calls admin_require() as its first act and raises for
-- anyone else - which is the check that matters, because it is the one a
-- client cannot skip. Granting to a narrower role instead would need a custom
-- JWT claim, and a claim can be stale for as long as the token lives; a table
-- lookup is right the moment the flag changes.


-- =====================================================================
-- Adding a section to the panel later
--
-- Each section is a read function plus, if it acts, a write function. Both
-- start with admin_require() and the write ends with admin_log(). Nothing
-- registers a route or a permission anywhere - the panel asks for what it
-- shows, and the database refuses anyone who should not see it.
--
-- Analytics, content management and site settings all fit that shape without
-- changing anything here.
-- =====================================================================
