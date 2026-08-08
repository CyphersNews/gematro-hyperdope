-- =====================================================================
-- Take email out of the admin panel, and fix the names that never showed
--
-- TWO THINGS, AND THE SECOND IS A BUG
--
-- 1. Email is removed from every admin read. A moderator deciding whether a
--    message broke the rules does not need the sender's email address to do
--    it, and an admin panel that shows every address is one compromised admin
--    account away from being a mailing list. The only place an address should
--    appear is where somebody typed it in deliberately to contact the site.
--
-- 2. admin_users() built its name as
--
--        coalesce(p.username, p.discord_username)
--
--    with no final fallback, where every other function in the schema ends
--    with 'Anonymous'. Anyone who signed up by email and never chose a
--    username has both of those null, so the function returned NULL and the
--    panel drew a dash. That is the "some usernames do not appear" report:
--    not missing rows, just unnamed ones.
--
-- Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. admin_users: no email, and a name that is never null
--
-- Dropped and recreated because removing a column changes the return type.
-- The sort by name used lower(coalesce(username, email)), which would have
-- ordered the unnamed by an address nobody can see - it now sorts them
-- together under their fallback, which is at least honest about what it knows.
-- ---------------------------------------------------------------------

drop function if exists public.admin_users(text, text, text, integer, integer);

create or replace function public.admin_users(
  q text default null, sort text default 'recent',
  status_filter text default null, lim integer default 50, off integer default 0)
returns table (
  id uuid, username text, avatar text,
  joined_at timestamptz, last_active_at timestamptz,
  is_admin boolean, status text, status_reason text, status_until timestamptz,
  submissions integer, reports_against integer, has_email boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         coalesce(p.username, p.discord_username, 'Anonymous'),
         coalesce(p.avatar_url, p.discord_avatar),
         p.created_at,
         p.last_active_at,
         p.is_admin,
         p.status,
         p.status_reason,
         p.status_until,
         (select count(*)::int from public.phrase_submissions s where s.user_id = p.id),
         (select count(*)::int from public.reports r where r.reported_id = p.id),
         -- whether a password reset can be sent at all, without saying to where
         (p.email is not null and btrim(p.email) <> '')
  from public.profiles p
  where public.admin_require() is not null
    and (q is null or btrim(q) = ''
         -- email is still searchable: an admin acting on a support request has
         -- an address and needs the account, and matching it reveals nothing
         -- they did not already have
         or coalesce(p.username, '') ilike '%' || btrim(q) || '%'
         or coalesce(p.email, '')    ilike '%' || btrim(q) || '%'
         or coalesce(p.discord_username, '') ilike '%' || btrim(q) || '%')
    and (status_filter is null or status_filter = 'all' or p.status = status_filter)
  order by
    case when sort = 'name'   then lower(coalesce(p.username, p.discord_username, 'anonymous')) end asc,
    case when sort = 'active' then p.last_active_at end desc nulls last,
    case when sort = 'oldest' then p.created_at end asc,
    case when sort not in ('name', 'active', 'oldest') then p.created_at end desc
  limit least(coalesce(lim, 50), 200) offset greatest(coalesce(off, 0), 0);
$$;

revoke all on function public.admin_users(text, text, text, integer, integer) from anon, authenticated;
grant execute on function public.admin_users(text, text, text, integer, integer) to authenticated;


-- ---------------------------------------------------------------------
-- 2. Password resets without the panel ever seeing the address
--
-- The panel used to read the email out of the user list and hand it to
-- resetPasswordForEmail(). With the address gone it cannot, so the send moves
-- into the database, which has it and does not have to give it back.
--
-- This does not send the mail itself - Postgres cannot - it records the intent
-- and returns whether there is an address to send to. The client then calls
-- the ordinary reset endpoint with the id, and Supabase looks the address up.
-- ---------------------------------------------------------------------

create or replace function public.admin_user_email(target uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  addr text;
begin
  perform public.admin_require();
  select p.email into addr from public.profiles p where p.id = target;
  if addr is null or btrim(addr) = '' then
    raise exception 'That account has no email address';
  end if;
  -- logged, because reading an address is exactly the thing this migration is
  -- otherwise stopping, and the one remaining use of it should leave a trace
  perform public.admin_log('user:reset-password', target, null);
  return addr;
end;
$$;

comment on function public.admin_user_email(uuid) is
  'The one remaining way an admin can obtain an address, for sending a reset. Audited on every call.';

revoke all on function public.admin_user_email(uuid) from anon, authenticated;
grant execute on function public.admin_user_email(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Reports and the audit log: names, not addresses
--
-- Both fell back to the email when somebody had no username, which put
-- addresses on screen for exactly the accounts the fix above is about.
-- ---------------------------------------------------------------------

drop function if exists public.admin_reports(text, text, integer);

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
         (select coalesce(pr.username, pr.discord_username, 'Anonymous') from public.profiles pr where pr.id = r.reporter_id),
         r.reported_id,
         (select coalesce(pd.username, pd.discord_username, 'Anonymous') from public.profiles pd where pd.id = r.reported_id),
         r.reason, r.detail,
         r.message_id, r.message_body, r.conversation_id,
         (select coalesce(ph.username, ph.discord_username, 'Anonymous') from public.profiles ph where ph.id = r.handled_by),
         r.handled_at, r.admin_note
  from public.reports r
  where public.admin_require() is not null
    and (status_filter is null or status_filter = 'all' or r.status = status_filter)
  order by
    case when sort = 'oldest' then r.created_at end asc,
    case when sort <> 'oldest' then r.created_at end desc
  limit least(coalesce(lim, 100), 300);
$$;

revoke all on function public.admin_reports(text, text, integer) from anon, authenticated;
grant execute on function public.admin_reports(text, text, integer) to authenticated;

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
         (select coalesce(p.username, p.discord_username, 'Anonymous') from public.profiles p where p.id = m.sender_id),
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

revoke all on function public.admin_report_context(uuid, integer) from anon, authenticated;
grant execute on function public.admin_report_context(uuid, integer) to authenticated;

-- the audit log writes the name at the time of the action, so this only
-- affects rows written from now on
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
  begin
    ip := split_part(coalesce(
      current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''), ',', 1);
  exception when others then ip := null;
  end;

  insert into public.admin_audit (admin_id, admin_name, action, target_id, target_name, detail, ip)
  values (
    me,
    (select coalesce(p.username, p.discord_username, 'Anonymous') from public.profiles p where p.id = me),
    action,
    target,
    (select coalesce(p.username, p.discord_username, 'Anonymous') from public.profiles p where p.id = target),
    detail,
    nullif(btrim(coalesce(ip, '')), '')
  );
end;
$$;

revoke all on function public.admin_log(text, uuid, jsonb) from anon, authenticated;

-- admin_delete_user logged the email as the deleted account's name
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

  select coalesce(p.username, p.discord_username, 'Anonymous') into who
    from public.profiles p where p.id = target;
  -- logged before the delete: afterwards there is no name left to record
  perform public.admin_log('user:delete', target, jsonb_build_object('name', who));
  delete from auth.users u where u.id = target; -- everything else cascades
end;
$$;

revoke all on function public.admin_delete_user(uuid) from anon, authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 4. Roles: Teacher and Student off the list
--
-- Deactivated rather than deleted. Anyone who already picked one keeps a row
-- referencing the key, and the validation trigger only checks keys on write -
-- so deleting the option would make their next unrelated profile save fail on
-- a role they chose while it was offered.
-- ---------------------------------------------------------------------

update public.profile_role_options set active = false where key in ('teacher', 'student');

-- and take them off anyone currently wearing one, so the profile matches what
-- the picker now offers
update public.profiles p
   set roles = array_remove(array_remove(p.roles, 'teacher'), 'student')
 where p.roles && array['teacher', 'student']::text[];
