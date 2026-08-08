-- =====================================================================
-- GDPR: consent evidence, data export, and a straight answer about erasure
--
-- The three rights that need code rather than prose are consent (Art. 7),
-- access/portability (Art. 15 and 20), and erasure (Art. 17). Two of the
-- three already existed in pieces; this file finishes them and writes down
-- the one thing we cannot do.
--
-- WHAT ALREADY EXISTED
--   erasure  - delete_own_account() removes the auth.users row and every
--              table cascades off it; match_forget() erases birth data alone
--   consent  - user_birth_data.matching_opt_in, dated by trigger
--
-- WHAT THIS FILE ADDS
--   consent  - a durable record of every grant and withdrawal, because
--              "matching_opt_in is currently false" is not evidence that it
--              was ever true, and a withdrawal we cannot evidence is a
--              withdrawal we cannot prove we honoured
--   access   - account_export(), one JSON document of everything we hold
--
-- WHAT WE CANNOT DO, AND MUST SAY SO
--   Stripe holds transaction records for its own retention period under UK
--   tax and company law. Deleting a Cyphers account removes our copy of the
--   subscription state and does not, and cannot, erase Stripe's ledger. The
--   privacy notice has to say that in those words - telling a member their
--   payment history is gone when it is not is itself a breach.
--
-- Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Consent as an append-only record
--
-- The current value lives on the profile row where the code can read it
-- cheaply. This is the audit trail behind it: who, what, when, and from the
-- database's own clock rather than the browser's.
-- ---------------------------------------------------------------------

create table if not exists public.consent_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  purpose     text not null,
  granted     boolean not null,
  created_at  timestamptz not null default now(),
  constraint consent_purpose check (purpose in
    ('matching', 'public_profile', 'llm_readings', 'marketing'))
);

comment on table public.consent_events is
  'Append-only consent log. The profile row holds the current value; this holds the history, which is what Article 7(1) asks you to be able to demonstrate.';

create index if not exists consent_events_user_idx
  on public.consent_events (user_id, purpose, created_at desc);

alter table public.consent_events enable row level security;

-- Readable by its subject, written only by the trigger below. A member who
-- could write this table could fabricate a consent they never gave.
drop policy if exists "consent_select_own" on public.consent_events;
create policy "consent_select_own" on public.consent_events for select
  to authenticated using ( (select auth.uid()) = user_id );

revoke all on public.consent_events from anon, authenticated;
grant select on public.consent_events to authenticated;

-- The matching opt-in already has a trigger that dates it. This records the
-- transition alongside, so the log is written by the same statement that
-- changes the value and the two cannot drift.
create or replace function public.ubd_log_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.matching_opt_in then
      insert into public.consent_events (user_id, purpose, granted)
      values (new.user_id, 'matching', true);
    end if;
  elsif new.matching_opt_in is distinct from old.matching_opt_in then
    insert into public.consent_events (user_id, purpose, granted)
    values (new.user_id, 'matching', new.matching_opt_in);
  end if;
  return new;
end;
$$;

drop trigger if exists user_birth_data_consent_log on public.user_birth_data;
create trigger user_birth_data_consent_log
  after insert or update on public.user_birth_data
  for each row execute function public.ubd_log_consent();


-- ---------------------------------------------------------------------
-- 2. Data export — Articles 15 and 20 in one call
--
-- One JSON document, structured rather than a dump, covering every table
-- that holds something about the caller. Two deliberate omissions:
--
--   * other people's messages. A chat export containing what somebody else
--     wrote is that person's data too, and Article 15 does not entitle one
--     member to a transcript of another. Only the caller's own messages are
--     included.
--   * moderation_events. It records that a message was blocked and why, with
--     no content, and disclosing the filter's decisions to the person it
--     fired on is how the filter gets reverse-engineered. This is the
--     Article 15(4) "rights and freedoms of others" carve-out and it is a
--     judgement worth stating rather than leaving implicit.
-- ---------------------------------------------------------------------

create or replace function public.account_export()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  out_doc jsonb;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;

  select jsonb_build_object(
    'exported_at', now(),
    'notice', 'Everything Cyphers holds about you. Payment records are held by '
              || 'Stripe under their own retention obligations and are not in this file — '
              || 'request those from Stripe, or from us and we will ask them.',

    'account', (
      select jsonb_build_object(
        'id', p.id, 'username', p.username, 'created_at', p.created_at,
        'discord_linked', (p.discord_id is not null),
        'avatar_url', p.avatar_url, 'roles', p.roles, 'fav_ciphers', p.fav_ciphers,
        'privacy', jsonb_build_object(
          'friend_policy', p.friend_policy, 'public_profile', p.public_profile,
          'show_online', p.show_online, 'show_last_active', p.show_last_active,
          'show_mutuals', p.show_mutuals, 'show_friend_count', p.show_friend_count))
      from public.profiles p where p.id = me),

    'email', (select u.email from auth.users u where u.id = me),

    'birth_data', (
      select to_jsonb(b) - 'user_id' from public.user_birth_data b where b.user_id = me),

    'cypher_preferences', (
      select to_jsonb(c) - 'user_id' from public.user_cypher_preferences c where c.user_id = me),

    'consent_history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'purpose', e.purpose, 'granted', e.granted, 'at', e.created_at)
        order by e.created_at), '[]'::jsonb)
      from public.consent_events e where e.user_id = me),

    'subscription', (
      select jsonb_build_object(
        'status', s.status, 'plan', s.plan, 'started_at', s.started_at,
        'current_period_end', s.current_period_end,
        'cancel_at_period_end', s.cancel_at_period_end)
      from public.subscriptions s where s.user_id = me),

    'history_entries', (
      select coalesce(jsonb_agg(to_jsonb(h) - 'user_id' order by h.created_at), '[]'::jsonb)
      from public.history_entries h where h.user_id = me),

    'saved_charts', (
      select coalesce(jsonb_agg(to_jsonb(b) - 'user_id' order by b.created_at), '[]'::jsonb)
      from public.birth_charts b where b.user_id = me),

    'presets', (
      select coalesce(jsonb_agg(to_jsonb(pr) - 'user_id' order by pr.created_at), '[]'::jsonb)
      from public.presets pr where pr.user_id = me),

    'submissions', (
      select coalesce(jsonb_agg(to_jsonb(sub) - 'user_id' order by sub.created_at), '[]'::jsonb)
      from public.phrase_submissions sub where sub.user_id = me),

    'posts', (
      select coalesce(jsonb_agg(to_jsonb(po) - 'user_id' order by po.created_at), '[]'::jsonb)
      from public.posts po where po.user_id = me),

    -- only what the caller wrote. The other side of a conversation is
    -- somebody else's personal data as much as it is theirs.
    'messages_i_sent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'body', m.body, 'sent_at', m.created_at) order by m.created_at), '[]'::jsonb)
      from public.messages m where m.sender_id = me),

    'friends', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'since', f.responded_at, 'status', f.status)), '[]'::jsonb)
      from public.friendships f
      where (f.user_a = me or f.user_b = me)),

    'llm_readings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'kind', u.prompt_type, 'at', u.created_at, 'status', u.status) order by u.created_at), '[]'::jsonb)
      from public.llm_usage u where u.user_id = me),

    'not_included', jsonb_build_array(
      'Messages other people sent you — those are their personal data too.',
      'Moderation decisions — disclosing which rule fired is how the filter gets worked around (UK GDPR Art. 15(4)).',
      'Payment records — held by Stripe, not by us.')
  ) into out_doc;

  return out_doc;
end;
$$;

comment on function public.account_export() is
  'UK GDPR Articles 15 and 20. Returns everything held about the caller as one JSON document. Takes no arguments: the subject is the JWT.';

revoke all on function public.account_export() from anon;
grant execute on function public.account_export() to authenticated;


-- ---------------------------------------------------------------------
-- 3. Erasure, finished
--
-- delete_own_account() already removes the auth.users row and cascades. Two
-- things did not cascade cleanly and are handled here.
-- ---------------------------------------------------------------------

-- billing_events.user_id is ON DELETE SET NULL, deliberately: the webhook
-- ledger has to survive an account deletion or a replayed Stripe event after
-- the deletion would be applied a second time. Nulling the user id leaves an
-- idempotency key with nothing personal attached to it, which is the right
-- shape - an event id is not personal data once it points at nobody.

-- moderation_events holds no content, but it does hold a user id. Erasure
-- means erasure: the row goes with the account.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'moderation_events'
                and column_name = 'user_id') then
    execute 'alter table public.moderation_events
             drop constraint if exists moderation_events_user_id_fkey';
    execute 'alter table public.moderation_events
             add constraint moderation_events_user_id_fkey
             foreign key (user_id) references auth.users (id) on delete cascade';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 4. Retention: the ledger does not grow for ever
--
-- llm_usage exists to enforce a rolling 24-hour limit. Keeping rows past the
-- point they can affect that limit is collecting data with no purpose, which
-- is the storage-limitation principle failing quietly. Ninety days is enough
-- for billing reconciliation and abuse investigation; after that it goes.
--
-- Schedule with pg_cron, or call it from any nightly job:
--   select cron.schedule('llm-prune', '0 4 * * *', 'select public.llm_prune()');
-- ---------------------------------------------------------------------

create or replace function public.llm_prune()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare gone integer;
begin
  delete from public.llm_usage u where u.created_at < now() - interval '90 days';
  get diagnostics gone = row_count;

  -- billing_events is an idempotency guard; a Stripe event id older than
  -- Stripe's own retry window can never arrive again
  delete from public.billing_events e where e.received_at < now() - interval '30 days';

  return gone;
end;
$$;

revoke all on function public.llm_prune() from anon, authenticated;
