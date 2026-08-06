-- =====================================================================
-- Security hardening, from the audit of 2026-08-06
--
-- Three holes and one information leak, all found by probing the live
-- database rather than by reading the SQL. Each probe below is quoted with the
-- error it returned, because "violates foreign key constraint" and "permission
-- denied" mean very different things and only one of them is safe.
--
-- Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. HIGH - anyone could forge a report
--
--     insert into reports (reporter_id, reported_id, reason,
--                          status, message_body, admin_note)
--     -> 23503 violates foreign key constraint "reports_reported_id_fkey"
--
-- A foreign key error means the GRANT and the POLICY both let the row
-- through, and only the ghost id in the probe stopped it. Aimed at a real
-- account it would have inserted a report with whatever the sender chose:
--
--   * message_body - fabricated evidence against another member, which the
--     admin panel displays verbatim as "the reported message"
--   * status = 'dismissed' - a report that never appears in the open queue
--   * admin_note - text attributed to a moderator who never wrote it
--   * message_id / conversation_id pointing at a conversation they are not in
--
-- and it bypassed member_report()'s one-hour rate limit entirely, so the same
-- member could be buried in reports.
--
-- The policy was never wrong about who: with check (auth.uid() = reporter_id)
-- is correct. It simply cannot say anything about WHICH COLUMNS, and every
-- other field was free.
--
-- member_report() is security definer and owned by the table owner, so it
-- still inserts fine with no direct grant at all. Taking the grant away leaves
-- exactly one way to create a report, and that way validates.
-- ---------------------------------------------------------------------

revoke insert on public.reports from authenticated, anon;

drop policy if exists "reports_insert_own" on public.reports;

comment on table public.reports is
  'Created only through member_report(). No direct insert grant: the policy could say who was reporting but not which columns they could set, and status, message_body and admin_note were all forgeable.';


-- ---------------------------------------------------------------------
-- 2. MEDIUM - the profile INSERT grant was never column-restricted
--
--     insert into profiles (id, is_admin) values (<self>, true)
--     -> 23505 duplicate key value violates "profiles_pkey"
--
-- A duplicate-key error means the grant and the policy accepted the row,
-- is_admin and all, and only the existing primary key stopped it. The UPDATE
-- path was locked down to eight columns in the admin migration; the INSERT
-- path was left wide, and the guard trigger is BEFORE UPDATE so it never fires
-- on an insert.
--
-- Not exploitable as things stand - handle_new_user() creates the row at
-- signup and there is no delete policy on profiles, so the row a member would
-- have to insert always already exists. It is one deleted row away from being
-- live, which is not a margin worth keeping.
--
-- The insert policy goes entirely rather than being column-restricted: the
-- trigger has created that row on every signup since the first migration, so
-- nothing has ever needed this.
-- ---------------------------------------------------------------------

revoke insert on public.profiles from authenticated, anon;

drop policy if exists "profiles_insert_own" on public.profiles;

-- ...and the guard now covers inserts too, in case a future migration puts an
-- insert path back without thinking about which columns it exposes.
create or replace function public.profiles_guard_privileged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_admin or new.status is distinct from 'active' then
      if coalesce(current_setting('app.admin_action', true), '') <> 'on' then
        raise exception 'Roles and account status cannot be set on insert';
      end if;
    end if;
    return new;
  end if;

  if new.is_admin is distinct from old.is_admin
     or new.status is distinct from old.status
     or new.email is distinct from old.email
  then
    if coalesce(current_setting('app.admin_action', true), '') <> 'on' then
      raise exception 'Roles and account status can only be changed by an administrator';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_privileged();


-- ---------------------------------------------------------------------
-- 3. MEDIUM - three tables in the exposed schema had RLS switched off
--
--     select * from mod_rules    -> 42501 permission denied
--     select * from mod_settings -> 42501 permission denied
--
-- Denied, so nothing is leaking today - but denied by the GRANT alone. RLS was
-- never enabled on mod_rules, mod_allow or mod_settings, so the only thing
-- standing between the filter's contents and the browser is a revoke that a
-- future "grant select on all tables in schema public" would silently undo.
-- That grant is a normal thing for someone to run.
--
-- Enabled with no policies at all, which denies everything to everyone except
-- the security definer functions that read them. Belt as well as braces, and
-- it clears the Supabase linter's rls_disabled_in_public warning.
--
-- Worth being explicit about why the rule list is not public: knowing a filter
-- exactly is most of the work of getting round it.
-- ---------------------------------------------------------------------

alter table public.mod_rules    enable row level security;
alter table public.mod_allow    enable row level security;
alter table public.mod_settings enable row level security;

revoke all on public.mod_rules, public.mod_allow, public.mod_settings from anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. LOW - account_active() answered about anybody
--
-- It is granted to authenticated because the phrase_submissions insert policy
-- calls it, and it took any uuid. So any member could ask "is this account
-- banned?" about anyone, one id at a time, and enumerate who had been actioned.
-- Moderation outcomes are nobody else's business.
--
-- It now answers only about the caller, or about anyone if the caller is an
-- admin - which is what admin_set_admin() needs. The policy passes auth.uid(),
-- so it is unaffected.
-- ---------------------------------------------------------------------

create or replace function public.account_active(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when uid is distinct from auth.uid() and not public.is_admin(auth.uid()) then false
    else coalesce((
      select p.status = 'active'
          or (p.status = 'suspended' and p.status_until is not null and p.status_until < now())
      from public.profiles p where p.id = uid
    ), false)
  end;
$$;


-- ---------------------------------------------------------------------
-- 5. Blocking a member should not leave the friendship behind
--
-- blocks has a direct insert grant, and member_block() is the function that
-- also removes the friendship. Inserting straight into the table blocks
-- somebody while staying friends with them - not a security problem, but a
-- state nothing else in the app expects, and it is free to close.
-- ---------------------------------------------------------------------

revoke insert on public.blocks from authenticated, anon;
drop policy if exists "blocks_insert_own" on public.blocks;

grant execute on function public.member_block(uuid) to authenticated;
grant execute on function public.member_unblock(uuid) to authenticated;


-- =====================================================================
-- What was checked and found sound
--
--   * The escalation this all started from is closed. As an ordinary member:
--       update profiles set is_admin = true where id = <self>  -> 42501
--       update profiles set status   = 'active'                -> 42501
--     Denied at the grant, which applies to the `authenticated` role itself,
--     so it is the same answer for every member regardless of any row value.
--
--   * Only the anon key ships. No service_role key, JWT or provider key
--     appears anywhere in the working tree or in any commit in the history.
--     The Edge Function reads its keys from Deno.env at runtime.
--
--   * Storage: avatar writes are pinned to (storage.foldername(name))[1] =
--     auth.uid(), so nobody can write into another member's folder. Read is
--     public, which is what an avatar is.
--
--   * reports, moderation_events, admin_audit, mod_* all refuse a direct read
--     from the browser: 42501 on every one.
--
--   * Every admin_* function calls admin_require() and raises for anyone else.
--
-- Still worth doing, and deliberately NOT done here
--
--   The admin read functions gate with `where public.admin_require() is not
--   null` inside a language-sql body. That is sound - a row can only be
--   emitted if the predicate passed, and the predicate raises rather than
--   returning false - but it depends on the planner rather than on statement
--   order, and admin_report_context() reads reports and messages in CTEs
--   before it is evaluated. Nothing escapes, because nothing is returned.
--
--   Converting those six to plpgsql with admin_require() as the first
--   statement would make the guarantee structural instead of incidental. It is
--   not done in this migration because they are working, the change is not
--   verifiable without a Postgres to run it against, and rewriting six live
--   functions to harden something that is already safe is the riskier move.
--   Worth doing deliberately, with a test, rather than as part of a fix for
--   something else.
-- =====================================================================
