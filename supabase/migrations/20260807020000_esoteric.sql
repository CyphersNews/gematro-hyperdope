-- =====================================================================
-- Esoteric depth: the LLM layer, its rate limit, and its ledger
--
-- The model call itself happens in an Edge Function holding the API key. This
-- file is everything around it: who may call, how often, and what we keep.
--
-- WHY THE RATE LIMIT IS IN THE DATABASE
--
-- An in-memory counter in the Edge Function is per-instance and resets on
-- every cold start, which on a serverless platform is "often". A member who
-- retries enough gets a fresh allowance each time. The ledger is a table, the
-- limit is a count over that table, and both live where the state already is.
--
-- The reservation is written BEFORE the model is called, not after. A call
-- that is billed but never recorded - because the function timed out, or the
-- provider was slow, or the process was recycled mid-flight - is a call
-- somebody can repeat for free. Reserving first means a failure costs the
-- member one slot rather than costing us an unbounded number of calls.
--
-- WHAT IS NOT STORED
--
-- Not the prompt, not the response. The ledger holds who, when, which prompt
-- type, and how many tokens - enough to enforce a limit and to bill, and
-- nothing that would turn a reflective reading about somebody's chart into a
-- durable record of it. There is a note column for failures, and it holds an
-- error class, never content.
--
-- Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The ledger
-- ---------------------------------------------------------------------

create table if not exists public.llm_usage (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  prompt_type    text not null,
  subject_id     uuid references auth.users (id) on delete set null,
  status         text not null default 'reserved',
  input_tokens   integer,
  output_tokens  integer,
  model          text,
  note           text,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,

  constraint llm_usage_type check (prompt_type in
    ('explain_gematria', 'compatibility_summary', 'deeper_reflection')),
  constraint llm_usage_status check (status in
    ('reserved', 'ok', 'refused', 'failed')),
  -- a note is an error class, never model output or member text
  constraint llm_usage_note_len check (note is null or length(note) <= 80)
);

comment on table public.llm_usage is
  'One row per LLM call attempt. Holds no prompt and no response text - only who, when, which prompt type, and token counts.';

create index if not exists llm_usage_user_time_idx
  on public.llm_usage (user_id, created_at desc);

alter table public.llm_usage enable row level security;

-- A member may read their own usage, which is what makes "3 of 5 left today"
-- honest rather than a number we assert at them. They may not write it.
drop policy if exists "llm_usage_select_own" on public.llm_usage;
create policy "llm_usage_select_own" on public.llm_usage for select
  to authenticated using ( (select auth.uid()) = user_id );

revoke all on public.llm_usage from anon, authenticated;
grant select on public.llm_usage to authenticated;


-- ---------------------------------------------------------------------
-- 2. The limits
--
-- Rows, not constants, for the same reason the feature flags are rows: the
-- number that turns out to be wrong on launch day should be an UPDATE.
--
-- Free members get a small non-zero allowance rather than zero. A feature
-- nobody can try is a feature nobody subscribes for, and three calls a day is
-- both a fair taste and a bill we can absorb.
-- ---------------------------------------------------------------------

create table if not exists public.llm_limits (
  tier          text primary key,
  per_day       integer not null,
  per_hour      integer not null,
  max_output    integer not null default 700,
  note          text not null default '',
  constraint llm_limits_tier check (tier in ('free', 'paid', 'admin')),
  constraint llm_limits_sane check (per_day >= 0 and per_hour >= 0 and max_output between 100 and 4000)
);

insert into public.llm_limits (tier, per_day, per_hour, max_output, note) values
  ('free',  3,  2, 500,  'Enough to see what it is. Not enough to use it as the feature.'),
  ('paid', 60, 15, 900,  'Generous but bounded — a runaway loop should cost pounds, not thousands.'),
  ('admin', 200, 40, 900, 'For testing prompts without burning the paid allowance.')
on conflict (tier) do nothing;

alter table public.llm_limits enable row level security;

drop policy if exists "llm_limits_read" on public.llm_limits;
create policy "llm_limits_read" on public.llm_limits for select
  to authenticated using ( true );

revoke all on public.llm_limits from anon, authenticated;
grant select on public.llm_limits to authenticated;


-- ---------------------------------------------------------------------
-- 3. Which tier is this member in
--
-- Subscription status decides, with the admin exception stated in the open
-- exactly as it is for match_list().
-- ---------------------------------------------------------------------

create or replace function public.llm_tier(who uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when who is null then 'free'
    when public.is_admin(who) then 'admin'
    when public.subscription_active(who) then 'paid'
    else 'free'
  end;
$$;

grant execute on function public.llm_tier(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 4. What the member can see about their own allowance
-- ---------------------------------------------------------------------

create or replace function public.llm_quota()
returns table (
  tier text, used_today integer, per_day integer,
  used_hour integer, per_hour integer, max_output integer
)
language sql
stable
security definer
set search_path = public
as $$
  with t as (select public.llm_tier(auth.uid()) as tier),
  lim as (select l.* from public.llm_limits l, t where l.tier = t.tier)
  select t.tier,
         (select count(*)::integer from public.llm_usage u
           where u.user_id = auth.uid()
             and u.created_at > now() - interval '24 hours'
             and u.status <> 'failed'),
         lim.per_day,
         (select count(*)::integer from public.llm_usage u
           where u.user_id = auth.uid()
             and u.created_at > now() - interval '1 hour'
             and u.status <> 'failed'),
         lim.per_hour,
         lim.max_output
    from t, lim;
$$;

grant execute on function public.llm_quota() to authenticated;


-- ---------------------------------------------------------------------
-- 5. Reserving a call
--
-- Called by the Edge Function as service_role, before the model call. Raises
-- if the member is over their limit; otherwise writes a 'reserved' row and
-- returns its id, which the function later marks 'ok' or 'failed'.
--
-- A 'failed' row does not count against the limit (see llm_quota above), so a
-- provider outage does not eat somebody's daily allowance. A 'reserved' row
-- that is never completed DOES count - that is the deliberate asymmetry which
-- makes abandoning requests mid-flight a losing strategy.
-- ---------------------------------------------------------------------

create or replace function public.llm_reserve(
  who uuid, kind text, subject uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  my_tier text;
  lim public.llm_limits;
  day_count integer;
  hour_count integer;
  fresh uuid;
begin
  if who is null then raise exception 'Not signed in' using errcode = '42501'; end if;

  my_tier := public.llm_tier(who);
  select * into lim from public.llm_limits l where l.tier = my_tier;
  if not found then raise exception 'No limit configured for tier %', my_tier; end if;

  select count(*) into day_count from public.llm_usage u
   where u.user_id = who and u.created_at > now() - interval '24 hours' and u.status <> 'failed';

  if day_count >= lim.per_day then
    raise exception 'You have used your readings for today (% of %)', day_count, lim.per_day
      using errcode = '53400';
  end if;

  select count(*) into hour_count from public.llm_usage u
   where u.user_id = who and u.created_at > now() - interval '1 hour' and u.status <> 'failed';

  if hour_count >= lim.per_hour then
    raise exception 'That is % readings this hour — try again shortly', hour_count
      using errcode = '53400';
  end if;

  insert into public.llm_usage (user_id, prompt_type, subject_id, status)
  values (who, kind, subject, 'reserved')
  returning id into fresh;

  return fresh;
end;
$$;

create or replace function public.llm_complete(
  usage uuid, new_status text, in_tokens integer default null,
  out_tokens integer default null, model_id text default null, why text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.llm_usage u
     set status = new_status,
         input_tokens = in_tokens,
         output_tokens = out_tokens,
         model = model_id,
         note = left(why, 80),
         completed_at = now()
   where u.id = usage and u.status = 'reserved';
$$;

-- Service role only. A browser that could call llm_complete could mark its own
-- reservations 'failed' and get an unlimited allowance.
revoke all on function public.llm_reserve(uuid, text, uuid) from anon, authenticated;
revoke all on function public.llm_complete(uuid, text, integer, integer, text, text)
  from anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. The facts a reading is allowed to be built from
--
-- The Edge Function does not accept chart data from the browser. A prompt
-- assembled from a request body is a prompt the member writes, and a member
-- who can write the prompt can write past the system prompt.
--
-- Instead the function asks for this, by member id, and gets back only what
-- that member is allowed to know about that person: the shared factors that
-- match_list() would already have shown them, and nothing else. No birth
-- date, no birth time, no place, ever.
-- ---------------------------------------------------------------------

create or replace function public.esoteric_context(subject uuid default null)
returns table (
  kind text,
  my_life_path smallint,
  their_life_path smallint,
  shared_factors text[],
  my_ciphers text[],
  score integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  mine public.user_birth_data;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;

  select * into mine from public.user_birth_data b where b.user_id = me;

  -- No subject: a reading about the member's own numbers. Always allowed.
  if subject is null or subject = me then
    return query
    select 'self'::text,
           mine.life_path,
           null::smallint,
           '{}'::text[],
           coalesce((select p.ciphers from public.user_cypher_preferences p where p.user_id = me), '{}'),
           null::integer;
    return;
  end if;

  -- A reading about a match. Reuse match_list() rather than re-deriving the
  -- comparison: it already carries the paywall, the opt-in check and the
  -- block check, so a second implementation here would be a second place for
  -- those to be wrong.
  return query
  select 'match'::text,
         mine.life_path,
         (select b.life_path from public.user_birth_data b where b.user_id = subject),
         m.factors,
         coalesce((select p.ciphers from public.user_cypher_preferences p where p.user_id = me), '{}'),
         m.score
    from public.match_list(100, 0) m
   where m.member_id = subject;
end;
$$;

grant execute on function public.esoteric_context(uuid) to authenticated;
