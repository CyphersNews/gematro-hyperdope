-- =====================================================================
-- Feature flags, subscriptions, and the paid Matching system
--
-- Three things arrive together because they only make sense together: a flag
-- that says whether Matching is behind a paywall, a record of who has paid,
-- and the matching itself, which asks both questions before it will answer.
--
-- WHERE THE PAYWALL ACTUALLY IS
--
-- It is match_list(). Not the page, not the button, not the flag file in
-- auth/. Everything the browser holds is a hint about what to draw; a member
-- who edits their own JavaScript, or calls the REST endpoint directly with the
-- anon key, still gets nothing, because the function raises before it selects.
-- The underlying tables have no policy that lets one member read another's
-- row at all, so there is no route to the data that does not go through the
-- gate.
--
-- WHAT IS STORED, AND WHY THAT MUCH
--
-- Matching needs a date of birth, and for the Ascendant a time and place.
-- That is personal data under UK GDPR and it is treated as such:
--
--   * user_birth_data is readable by its owner and by nobody else, ever. No
--     view, no function, and no policy exposes another member's date, time or
--     place of birth. What crosses between two members is the derived
--     signature - twelve small integers and a life path number - and even
--     that is only ever reported as "you share this", never as a value the
--     other person did not choose to publish.
--   * Entering birth data does not enter you into matching. matching_opt_in
--     is a separate, explicit, off-by-default consent, and match_forget()
--     erases the lot in one call.
--   * No payment details are stored here. Not a card, not a last four, not a
--     billing address. subscriptions holds a status, a period end, and the
--     provider's own identifiers - the provider is the data controller for
--     the payment instrument and it stays that way.
--
-- Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Feature flags
--
-- Rows rather than constants, so turning the paywall off for a weekend is an
-- UPDATE and not a deploy. Readable by everyone including signed-out visitors,
-- because the landing page needs to know whether to advertise the thing;
-- writable only by an administrator, through a function that logs the change.
-- ---------------------------------------------------------------------

create table if not exists public.feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  label       text not null default '',
  note        text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  constraint feature_flags_key_shape check (key ~ '^[a-z][a-z0-9_]{2,48}$')
);

comment on table public.feature_flags is
  'Runtime switches. The client reads these to decide what to draw; the server reads them to decide what to allow.';

insert into public.feature_flags (key, enabled, label, note) values
  ('matching_enabled', true, 'Matching system',
   'Master switch. Off means the Matching page shows its coming-soon card to everybody, including subscribers.'),
  ('matching_requires_payment', true, 'Matching paywall',
   'On means an active subscription is required. Off opens Matching to every signed-in member - use for a free trial period or a beta.'),
  ('matching_llm_depth', false, 'LLM readings',
   'Reserved for the esoteric-depth write-ups. Nothing reads this yet.')
on conflict (key) do nothing;

alter table public.feature_flags enable row level security;

drop policy if exists "feature_flags_read_all" on public.feature_flags;
create policy "feature_flags_read_all" on public.feature_flags for select
  to anon, authenticated using ( true );

revoke all on public.feature_flags from anon, authenticated;
grant select on public.feature_flags to anon, authenticated;
-- deliberately no insert/update/delete grant: admin_set_flag() is the only writer

-- Reads the flag, or the supplied default when the row is missing. Called from
-- inside other security definer functions, so it must not depend on RLS.
create or replace function public.flag_enabled(flag_key text, fallback boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select f.enabled from public.feature_flags f where f.key = flag_key), fallback);
$$;

grant execute on function public.flag_enabled(text, boolean) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Subscriptions
--
-- One row per member, written only by the payment webhook running as
-- service_role. There is no insert or update grant for `authenticated` at all,
-- which is the whole point: a member can read their own status and cannot
-- write it. Granting update on a status column and relying on a policy to
-- police the values would mean the paywall came down to whether that policy
-- was written correctly. This way there is nothing to get wrong.
-- ---------------------------------------------------------------------

create table if not exists public.subscriptions (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  status               text not null default 'none',
  plan                 text not null default 'match_monthly',
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  provider             text not null default 'stripe',
  provider_customer_id text,
  provider_sub_id      text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint subscriptions_status check (status in
    ('none', 'trialing', 'active', 'past_due', 'canceled', 'paused', 'comped'))
);

comment on table public.subscriptions is
  'Subscription state mirrored from the payment provider. Contains no payment instrument data - no card number, no last four, no billing address.';

create index if not exists subscriptions_status_idx on public.subscriptions (status);

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions for select
  to authenticated using ( (select auth.uid()) = user_id );

revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

-- 'comped' is a real status rather than a flag somewhere else: moderators,
-- competition winners and the odd apology all need an account that works, and
-- one column that answers "may they use it" is easier to reason about than a
-- status plus a list of exceptions.
create or replace function public.subscription_active(who uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.subscriptions s
     where s.user_id = who
       and s.status in ('active', 'trialing', 'comped')
       and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

grant execute on function public.subscription_active(uuid) to authenticated;

-- What the member is allowed to know about their own subscription. Wrapped in
-- a function rather than left to a plain select so the provider's identifiers
-- never reach the browser: a Stripe customer id is not a secret, but it is not
-- the browser's business either.
create or replace function public.subscription_mine()
returns table (
  status text, plan text, current_period_end timestamptz,
  cancel_at_period_end boolean, active boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(s.status, 'none'),
         coalesce(s.plan, 'match_monthly'),
         s.current_period_end,
         coalesce(s.cancel_at_period_end, false),
         public.subscription_active(auth.uid())
    from (values (1)) as one(x)
    left join public.subscriptions s on s.user_id = auth.uid();
$$;

grant execute on function public.subscription_mine() to authenticated;


-- ---------------------------------------------------------------------
-- 3. Birth data
--
-- Both the raw inputs and the derived signature live here, in one row per
-- member, because they are the same fact at two levels of detail and keeping
-- them apart would only mean two chances for them to disagree.
--
-- The signature is computed in the browser and sent up. That is not a hole:
-- the member types their own birth date, so they could put anything they liked
-- in either the input or the output. The gate this feature actually needs is
-- on who may LOOK at matches, and that one is here in the database.
--
-- The alternative was porting Schlyter's orbital elements into PL/pgSQL to
-- recompute the signs server-side. That is a lot of trigonometry to defend
-- against someone lying about their own birthday to get worse matches.
-- ---------------------------------------------------------------------

create table if not exists public.user_birth_data (
  user_id        uuid primary key references auth.users (id) on delete cascade,

  -- raw inputs: owner-readable only, never compared across members
  birth_date     date not null,
  birth_time     time,                       -- null means "I do not know it"
  place_label    text not null default '',
  latitude       double precision,
  longitude      double precision,
  tz_offset      double precision not null default 0,

  -- derived signature: sign indexes 0=Aries .. 11=Pisces, null when unknown
  sun_sign       smallint,
  moon_sign      smallint,
  mercury_sign   smallint,
  venus_sign     smallint,
  mars_sign      smallint,
  jupiter_sign   smallint,
  saturn_sign    smallint,
  asc_sign       smallint,                   -- only when the birth time is known
  life_path      smallint,
  zodiac         text not null default 'tropical',

  -- consent, off by default and separate from having entered the data at all
  matching_opt_in boolean not null default false,
  opted_in_at     timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint ubd_zodiac  check (zodiac in ('tropical', 'sidereal')),
  constraint ubd_lat     check (latitude is null or (latitude between -90 and 90)),
  constraint ubd_lon     check (longitude is null or (longitude between -180 and 180)),
  constraint ubd_tz      check (tz_offset between -14 and 14),
  constraint ubd_place   check (length(place_label) <= 120),
  constraint ubd_born    check (birth_date > date '1900-01-01' and birth_date < current_date),
  constraint ubd_signs   check (
       (sun_sign     is null or sun_sign     between 0 and 11)
   and (moon_sign    is null or moon_sign    between 0 and 11)
   and (mercury_sign is null or mercury_sign between 0 and 11)
   and (venus_sign   is null or venus_sign   between 0 and 11)
   and (mars_sign    is null or mars_sign    between 0 and 11)
   and (jupiter_sign is null or jupiter_sign between 0 and 11)
   and (saturn_sign  is null or saturn_sign  between 0 and 11)
   and (asc_sign     is null or asc_sign     between 0 and 11)),
  constraint ubd_lifepath check (life_path is null or life_path between 1 and 33)
);

comment on table public.user_birth_data is
  'Birth data and its derived signature. Personal data: readable by its owner only. Matching compares the signature through a security definer function and never exposes a row.';

create index if not exists ubd_optin_idx on public.user_birth_data (matching_opt_in) where matching_opt_in;

drop trigger if exists user_birth_data_touch_updated_at on public.user_birth_data;
create trigger user_birth_data_touch_updated_at
  before update on public.user_birth_data
  for each row execute function public.touch_updated_at();

alter table public.user_birth_data enable row level security;

drop policy if exists "ubd_select_own" on public.user_birth_data;
create policy "ubd_select_own" on public.user_birth_data for select
  to authenticated using ( (select auth.uid()) = user_id );

drop policy if exists "ubd_insert_own" on public.user_birth_data;
create policy "ubd_insert_own" on public.user_birth_data for insert
  to authenticated with check ( (select auth.uid()) = user_id );

drop policy if exists "ubd_update_own" on public.user_birth_data;
create policy "ubd_update_own" on public.user_birth_data for update
  to authenticated using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "ubd_delete_own" on public.user_birth_data;
create policy "ubd_delete_own" on public.user_birth_data for delete
  to authenticated using ( (select auth.uid()) = user_id );

revoke all on public.user_birth_data from anon, authenticated;
grant select, insert, update, delete on public.user_birth_data to authenticated;


-- ---------------------------------------------------------------------
-- 4. Cypher preferences
--
-- Which systems a member works in, and what their chosen phrase comes to in
-- each. The phrase is usually their own name, so it is treated as publishable
-- only in the sense that the member typed it knowing it would be compared -
-- the matching function reports shared VALUES, never the phrase itself.
-- ---------------------------------------------------------------------

create table if not exists public.user_cypher_preferences (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  ciphers      text[] not null default '{}',
  key_phrase   text not null default '',
  cipher_values jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint ucp_ciphers_count  check (array_length(ciphers, 1) is null or array_length(ciphers, 1) <= 12),
  constraint ucp_phrase_len     check (length(key_phrase) <= 120),
  constraint ucp_values_shape   check (jsonb_typeof(cipher_values) = 'object')
);

comment on table public.user_cypher_preferences is
  'Chosen cypher systems and what the member''s key phrase comes to in each. Compared through the matching function only.';

drop trigger if exists ucp_touch_updated_at on public.user_cypher_preferences;
create trigger ucp_touch_updated_at
  before update on public.user_cypher_preferences
  for each row execute function public.touch_updated_at();

alter table public.user_cypher_preferences enable row level security;

drop policy if exists "ucp_select_own" on public.user_cypher_preferences;
create policy "ucp_select_own" on public.user_cypher_preferences for select
  to authenticated using ( (select auth.uid()) = user_id );

drop policy if exists "ucp_insert_own" on public.user_cypher_preferences;
create policy "ucp_insert_own" on public.user_cypher_preferences for insert
  to authenticated with check ( (select auth.uid()) = user_id );

drop policy if exists "ucp_update_own" on public.user_cypher_preferences;
create policy "ucp_update_own" on public.user_cypher_preferences for update
  to authenticated using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "ucp_delete_own" on public.user_cypher_preferences;
create policy "ucp_delete_own" on public.user_cypher_preferences for delete
  to authenticated using ( (select auth.uid()) = user_id );

revoke all on public.user_cypher_preferences from anon, authenticated;
grant select, insert, update, delete on public.user_cypher_preferences to authenticated;


-- ---------------------------------------------------------------------
-- 5. Scoring helpers
--
-- Sign index 0..11 runs Aries to Pisces, so the element is the index mod 4
-- (fire, earth, air, water) and the modality the index mod 3 (cardinal, fixed,
-- mutable). Both fall straight out of the order the signs are already in.
-- ---------------------------------------------------------------------

create or replace function public.astro_sign_name(idx smallint)
returns text
language sql
immutable
as $$
  select case idx
    when 0 then 'Aries'  when 1 then 'Taurus'   when 2  then 'Gemini'
    when 3 then 'Cancer' when 4 then 'Leo'      when 5  then 'Virgo'
    when 6 then 'Libra'  when 7 then 'Scorpio'  when 8  then 'Sagittarius'
    when 9 then 'Capricorn' when 10 then 'Aquarius' when 11 then 'Pisces'
  end;
$$;

create or replace function public.astro_element(idx smallint)
returns text
language sql
immutable
as $$
  select case idx % 4 when 0 then 'Fire' when 1 then 'Earth' when 2 then 'Air' else 'Water' end;
$$;

-- The digits of the birth date, reduced, keeping 11, 22 and 33 whole. Done in
-- SQL rather than taken from the client because it follows from the date with
-- no ephemeris involved, so there is no reason for two implementations.
create or replace function public.numerology_life_path(born date)
returns smallint
language plpgsql
immutable
as $$
declare
  n integer := 0;
  ch text;
begin
  if born is null then return null; end if;
  foreach ch in array regexp_split_to_array(to_char(born, 'YYYYMMDD'), '') loop
    n := n + ch::integer;
  end loop;
  while n > 9 and n <> 11 and n <> 22 and n <> 33 loop
    declare s integer := 0; d text;
    begin
      foreach d in array regexp_split_to_array(n::text, '') loop
        s := s + d::integer;
      end loop;
      n := s;
    end;
  end loop;
  return n::smallint;
end;
$$;

grant execute on function public.astro_sign_name(smallint) to authenticated;
grant execute on function public.astro_element(smallint) to authenticated;
grant execute on function public.numerology_life_path(date) to authenticated;

-- The life path follows from the date with no ephemeris involved, so it is
-- derived here on every write rather than accepted from the browser. The
-- planetary signs cannot be done this way - those need the orbital elements -
-- but there is no reason to let two implementations of this one drift.
create or replace function public.ubd_derive_life_path()
returns trigger
language plpgsql
as $$
begin
  new.life_path := public.numerology_life_path(new.birth_date);

  -- An opt-in is dated when it is given, so consent can be evidenced.
  --
  -- The INSERT and UPDATE cases are separate branches rather than one
  -- condition with `tg_op = 'INSERT' or not old...` in it: plpgsql evaluates
  -- an IF condition as a whole SQL expression and does not promise to
  -- short-circuit, so touching OLD on an INSERT - where it is unassigned -
  -- would raise rather than be skipped.
  if not new.matching_opt_in then
    new.opted_in_at := null;
  elsif tg_op = 'INSERT' then
    new.opted_in_at := now();
  elsif not old.matching_opt_in then
    new.opted_in_at := now();   -- off to on: this is the moment consent was given
  end if;

  return new;
end;
$$;

drop trigger if exists user_birth_data_derive on public.user_birth_data;
create trigger user_birth_data_derive
  before insert or update on public.user_birth_data
  for each row execute function public.ubd_derive_life_path();


-- ---------------------------------------------------------------------
-- 6. Matching
--
-- Computed on the fly. The comparison is a handful of integer equality tests
-- against every other opted-in member, which Postgres does in single-digit
-- milliseconds at the scale this site will see for a long while. A match_scores
-- cache would buy nothing today and would immediately raise the question the
-- cache always raises, which is what happens between somebody editing their
-- birth data and the cache noticing. When the member count makes that trade
-- worth taking, the shape to add is a materialised view refreshed nightly over
-- exactly this query - the scoring lives in one function so that stays a small
-- change.
--
-- The weights below are a judgement, not a measurement. They are gathered at
-- the top of the function so they can be argued with in one place.
-- ---------------------------------------------------------------------

-- The short human line under a score. Kept separate so the wording can change
-- without touching the arithmetic, and so it can never accidentally report a
-- value the other member did not also have - every branch here is a statement
-- about something the two people SHARE.
create or replace function public.match_factors(
  their_sun smallint, my_sun smallint,
  their_moon smallint, my_moon smallint,
  their_venus smallint, my_venus smallint,
  their_mars smallint, my_mars smallint,
  their_asc smallint, my_asc smallint,
  their_lp smallint, my_lp smallint,
  shared_ciphers integer, shared_values integer,
  my_values jsonb, their_values jsonb)
returns text[]
language plpgsql
immutable
as $$
declare
  out_list text[] := '{}';
  hit record;
begin
  if their_lp is not null and their_lp = my_lp then
    out_list := out_list || ('Life Path ' || their_lp);
  end if;

  if their_sun is not null and their_sun = my_sun then
    out_list := out_list || ('Sun in ' || public.astro_sign_name(their_sun));
  end if;

  if their_moon is not null and their_moon = my_moon then
    out_list := out_list || ('Moon in ' || public.astro_sign_name(their_moon));
  end if;

  if their_venus is not null and their_venus = my_venus then
    out_list := out_list || ('Venus in ' || public.astro_sign_name(their_venus));
  end if;

  if their_asc is not null and their_asc = my_asc then
    out_list := out_list || (public.astro_sign_name(their_asc) || ' rising');
  end if;

  if their_mars is not null and their_mars = my_mars then
    out_list := out_list || ('Mars in ' || public.astro_sign_name(their_mars));
  end if;

  -- name the cypher and the number, but only where both sides hold it
  if their_values is not null then
    for hit in
      select mv.key as k, mv.value as v
        from jsonb_each_text(coalesce(my_values, '{}'::jsonb)) mv
       where their_values ? mv.key
         and (their_values ->> mv.key) = mv.value
       order by mv.key
       limit 2
    loop
      out_list := out_list || (hit.k || ' — both ' || hit.v);
    end loop;
  end if;

  if array_length(out_list, 1) is null and shared_ciphers > 0 then
    out_list := out_list || (shared_ciphers || ' cypher system' ||
                             case when shared_ciphers = 1 then '' else 's' end || ' in common');
  end if;

  -- at most four, so a card stays a card
  return out_list[1:4];
end;
$$;

grant execute on function public.match_factors(
  smallint, smallint, smallint, smallint, smallint, smallint, smallint, smallint,
  smallint, smallint, smallint, smallint, integer, integer, jsonb, jsonb) to authenticated;


create or replace function public.match_list(lim integer default 40, off integer default 0)
returns table (
  member_id     uuid,
  display_name  text,
  avatar        text,
  score         integer,
  factors       text[],
  is_friend     boolean,
  last_active_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  mine public.user_birth_data;
  my_ciphers text[];
  my_values jsonb;
begin
  if me is null then
    raise exception 'Sign in to use Matching' using errcode = '42501';
  end if;

  if not public.flag_enabled('matching_enabled', false) then
    raise exception 'Matching is not open yet' using errcode = '22023';
  end if;

  -- The paywall. An administrator gets through so the feature can be checked
  -- without a card against it; that is a deliberate exception and it is here
  -- in the open rather than hidden in a policy.
  if public.flag_enabled('matching_requires_payment', true)
     and not public.subscription_active(me)
     and not public.is_admin(me) then
    raise exception 'Matching needs an active subscription' using errcode = '42501';
  end if;

  select * into mine from public.user_birth_data b where b.user_id = me;
  if not found then
    raise exception 'Add your birth details first' using errcode = '22023';
  end if;
  if not mine.matching_opt_in then
    raise exception 'Turn on matching in your Matching profile first' using errcode = '22023';
  end if;

  select coalesce(p.ciphers, '{}'), coalesce(p.cipher_values, '{}'::jsonb)
    into my_ciphers, my_values
    from public.user_cypher_preferences p where p.user_id = me;
  my_ciphers := coalesce(my_ciphers, '{}');
  my_values  := coalesce(my_values, '{}'::jsonb);

  return query
  with them as (
    select b.*
      from public.user_birth_data b
     where b.user_id <> me
       and b.matching_opt_in
       and public.account_active(b.user_id)
       -- somebody you have blocked, or who has blocked you, is not a match
       and not exists (
         select 1 from public.blocks bl
          where (bl.blocker_id = me and bl.blocked_id = b.user_id)
             or (bl.blocker_id = b.user_id and bl.blocked_id = me))
  ),
  scored as (
    select
      t.user_id,
      -- only the ones the factor line can talk about are carried forward;
      -- Mercury, Jupiter and Saturn score but do not get a sentence
      t.sun_sign, t.moon_sign, t.venus_sign, t.mars_sign, t.asc_sign, t.life_path,
      -- ---- astrology, 55 available ----
      (case when t.sun_sign   is not null and t.sun_sign   = mine.sun_sign   then 12
            when t.sun_sign   is not null and mine.sun_sign is not null
             and public.astro_element(t.sun_sign) = public.astro_element(mine.sun_sign) then 6
            else 0 end)
    + (case when t.moon_sign  is not null and t.moon_sign  = mine.moon_sign  then 12
            when t.moon_sign  is not null and mine.moon_sign is not null
             and public.astro_element(t.moon_sign) = public.astro_element(mine.moon_sign) then 5
            else 0 end)
    + (case when t.venus_sign is not null and t.venus_sign = mine.venus_sign then 10
            when t.venus_sign is not null and mine.venus_sign is not null
             and public.astro_element(t.venus_sign) = public.astro_element(mine.venus_sign) then 4
            else 0 end)
    + (case when t.mars_sign    is not null and t.mars_sign    = mine.mars_sign    then 6 else 0 end)
    + (case when t.mercury_sign is not null and t.mercury_sign = mine.mercury_sign then 4 else 0 end)
    + (case when t.jupiter_sign is not null and t.jupiter_sign = mine.jupiter_sign then 3 else 0 end)
    + (case when t.saturn_sign  is not null and t.saturn_sign  = mine.saturn_sign  then 3 else 0 end)
      -- the Ascendant only exists for two people who both know their birth time
    + (case when t.asc_sign is not null and t.asc_sign = mine.asc_sign then 8 else 0 end)
      as astro_points,
      -- ---- numerology, 20 available ----
      (case when t.life_path is not null and t.life_path = mine.life_path then 14
            when t.life_path is not null and mine.life_path is not null
             and (t.life_path in (11,22,33)) and (mine.life_path in (11,22,33)) then 8
            else 0 end)
      as num_points,
      -- ---- gematria, 25 available ----
      -- shared systems, then the values that actually agree inside them
      (select count(*) from unnest(my_ciphers) as mc(name)
        where mc.name = any (coalesce(o.ciphers, '{}'))) as shared_ciphers,
      (select count(*) from jsonb_each_text(my_values) mv
        where coalesce(o.cipher_values, '{}'::jsonb) ? mv.key
          and (coalesce(o.cipher_values, '{}'::jsonb) ->> mv.key) = mv.value) as shared_values,
      coalesce(array_length(my_ciphers, 1), 0) as my_cipher_count,
      o.cipher_values as their_values
    from them t
    left join public.user_cypher_preferences o on o.user_id = t.user_id
  ),
  totalled as (
    select s.*,
           s.astro_points + s.num_points
         + least(10, case when s.my_cipher_count = 0 then 0
                          else round(10.0 * s.shared_ciphers / s.my_cipher_count) end)
         + least(15, 8 * s.shared_values)
           as raw_points
      from scored s
  )
  select
    t.user_id,
    coalesce(pr.username, pr.discord_username, 'Anonymous'),
    coalesce(pr.avatar_url, pr.discord_avatar),
    -- 100 points are available; a perfect stranger scores 0 and two people who
    -- agree on everything score 100, so the number is already a percentage.
    least(100, greatest(0, t.raw_points))::integer,
    public.match_factors(
      t.sun_sign, mine.sun_sign, t.moon_sign, mine.moon_sign,
      t.venus_sign, mine.venus_sign, t.mars_sign, mine.mars_sign,
      t.asc_sign, mine.asc_sign, t.life_path, mine.life_path,
      t.shared_ciphers::integer, t.shared_values::integer,
      my_values, t.their_values),
    exists (select 1 from public.friendships f
             where f.user_a = least(me, t.user_id)
               and f.user_b = greatest(me, t.user_id)
               and f.status = 'accepted'),
    case when pr.show_last_active then pr.last_active_at end
  from totalled t
  join public.profiles pr on pr.id = t.user_id
  where t.raw_points > 0
  order by t.raw_points desc, pr.last_active_at desc nulls last
  limit greatest(1, least(coalesce(lim, 40), 100))
  offset greatest(0, coalesce(off, 0));
end;
$$;

revoke all on function public.match_list(integer, integer) from anon, authenticated;
grant execute on function public.match_list(integer, integer) to authenticated;


-- ---------------------------------------------------------------------
-- 7. What the member can see about their own readiness
--
-- The page needs to say "you are two steps from your first match" without
-- calling match_list() and catching an exception to find out. Everything here
-- is about the caller, so it needs no gate of its own.
-- ---------------------------------------------------------------------

create or replace function public.match_status()
returns table (
  enabled boolean, requires_payment boolean, subscribed boolean,
  has_birth_data boolean, has_time boolean, opted_in boolean,
  cipher_count integer, pool integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.flag_enabled('matching_enabled', false),
    public.flag_enabled('matching_requires_payment', true),
    public.subscription_active(auth.uid()) or public.is_admin(auth.uid()),
    exists (select 1 from public.user_birth_data b where b.user_id = auth.uid()),
    exists (select 1 from public.user_birth_data b where b.user_id = auth.uid() and b.birth_time is not null),
    exists (select 1 from public.user_birth_data b where b.user_id = auth.uid() and b.matching_opt_in),
    coalesce((select array_length(p.ciphers, 1) from public.user_cypher_preferences p
               where p.user_id = auth.uid()), 0)::integer,
    -- how many other people are in the pool, so an empty result reads as
    -- "nobody yet" rather than "something is broken"
    (select count(*) from public.user_birth_data b
      where b.user_id <> auth.uid() and b.matching_opt_in)::integer;
$$;

grant execute on function public.match_status() to authenticated;


-- Right to erasure, at the level of this one feature. Deleting the account
-- already takes these with it; this is for the member who wants to stay but
-- wants their birth data gone.
create or replace function public.match_forget()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.user_cypher_preferences p where p.user_id = auth.uid();
  delete from public.user_birth_data b where b.user_id = auth.uid();
$$;

grant execute on function public.match_forget() to authenticated;


-- ---------------------------------------------------------------------
-- 8. Administration
--
-- Flipping a flag and comping a subscription are both things that should leave
-- a trace, so both go through admin_log() like every other admin action.
-- ---------------------------------------------------------------------

create or replace function public.admin_flags()
returns table (key text, enabled boolean, label text, note text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  -- admin_require() returns the caller's uuid and raises if they are not an
  -- admin, so the comparison is the idiom the rest of the panel uses: the
  -- predicate is never actually false, it just never gets evaluated for
  -- somebody who should not be here.
  select f.key, f.enabled, f.label, f.note, f.updated_at
    from public.feature_flags f
   where public.admin_require() is not null
   order by f.key;
$$;

create or replace function public.admin_set_flag(flag_key text, on_off boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_require();

  update public.feature_flags f
     set enabled = on_off, updated_at = now(), updated_by = auth.uid()
   where f.key = flag_key;

  if not found then raise exception 'No such flag'; end if;

  perform public.admin_log('set_flag', null,
    jsonb_build_object('flag', flag_key, 'enabled', on_off));
  return on_off;
end;
$$;

-- Grants access without taking a payment: the comp path, used for moderators
-- and for anyone the site owes a favour. Everything else about a subscription
-- arrives from the provider's webhook.
create or replace function public.admin_set_subscription(
  target uuid, new_status text, until timestamptz default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_require();

  if new_status not in ('none', 'active', 'trialing', 'comped', 'canceled', 'paused') then
    raise exception 'Not a status this can set';
  end if;

  insert into public.subscriptions (user_id, status, current_period_end, provider)
  values (target, new_status, until, 'manual')
  on conflict (user_id) do update
     set status = excluded.status,
         current_period_end = excluded.current_period_end,
         updated_at = now();

  perform public.admin_log('set_subscription', target,
    jsonb_build_object('status', new_status, 'until', until));
  return new_status;
end;
$$;

grant execute on function public.admin_flags() to authenticated;
grant execute on function public.admin_set_flag(text, boolean) to authenticated;
grant execute on function public.admin_set_subscription(uuid, text, timestamptz) to authenticated;
