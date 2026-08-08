-- =====================================================================
-- MATCHING_FORCE_FREE — premium infrastructure intact, gate bypassed
--
-- Everything about the paid path stays exactly where it is: Stripe checkout,
-- the portal, the webhook, subscriptions, current_period_end, the flags, the
-- route protection. Nothing is deleted and nothing is commented out. One
-- boolean is added to the front of the gate.
--
-- WHY A SECOND FLAG RATHER THAN FLIPPING THE FIRST
--
-- matching_requires_payment = false already opens Matching to everyone, and
-- for a free beta that is the right switch — it says "this is how the product
-- works right now". This is a different statement: "this is temporarily
-- unlocked for testing and MUST be turned off before launch".
--
-- Keeping them apart means you can tell at a glance which state you are in,
-- and the banner only appears in the second. One flag doing both jobs is a
-- flag nobody can read the intent of six weeks later.
--
--   matching_requires_payment = false  ->  free product, no banner
--   matching_force_free       = true   ->  TESTING, banner shown, flip before launch
--
-- WHY IT IS A DATABASE ROW AND NOT AN ENVIRONMENT VARIABLE
--
-- The gate is match_list(), which runs inside Postgres. Postgres cannot read a
-- Supabase Edge Function's environment, so an env var physically cannot be the
-- authority for this check — it could only be a copy that drifts. The row IS
-- the authority, and flipping it is a single UPDATE or one click in the admin
-- panel under Flags, which is the same one-step flip an env var would give.
--
-- auth/flags.js carries the matching default for the moment before the network
-- answers; that is the deploy-time knob, and it is a hint for drawing only.
--
-- >>> BEFORE LAUNCH <<<
--   update public.feature_flags set enabled = false where key = 'matching_force_free';
-- Paid gating returns on the next call. No deploy, no restart, no code change.
--
-- Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The flag
--
-- Seeded TRUE because that is the state being asked for now. This is the one
-- flag in the file whose safe default is not its seeded value, so it is worth
-- saying out loud: shipping to production with this on gives Matching away.
-- ---------------------------------------------------------------------

insert into public.feature_flags (key, enabled, label, note) values
  ('matching_force_free', true, 'Testing mode — Matching is free',
   'TEMPORARY. Every signed-in member gets Matching and the paid LLM allowance with no subscription. '
   || 'Stripe checkout still works and can still be tested. Turn this OFF before launch — '
   || 'paid gating returns on the next call, with no deploy.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------
-- 2. One place that decides whether a member may use Matching
--
-- The three reasons someone gets through - testing mode, an active
-- subscription, being an administrator - were previously inline in
-- match_list() and restated in match_status(). Two copies of an access rule is
-- one copy too many; this is the single answer all of them now ask.
--
-- Deliberately NOT folded into subscription_active(). That function answers
-- "is this person paying", which the billing UI and the admin panel both rely
-- on being literally true. If force-free made it return true, every member
-- would see a SUBSCRIBED badge and believe they were being charged.
-- ---------------------------------------------------------------------

create or replace function public.matching_access(who uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select who is not null
     and (
          -- testing mode: everyone in
          public.flag_enabled('matching_force_free', false)
          -- or the paywall is off as a product decision
          or not public.flag_enabled('matching_requires_payment', true)
          -- or they are actually paying
          or public.subscription_active(who)
          -- or they are staff, checking the feature without a card against it
          or public.is_admin(who)
     );
$$;

grant execute on function public.matching_access(uuid) to authenticated;

comment on function public.matching_access(uuid) is
  'The single answer to "may this member use Matching". Consulted by match_list, match_status and llm_tier so the four ways through cannot drift apart.';


-- ---------------------------------------------------------------------
-- 3. match_list(), restated with that one line changed
--
-- Postgres has no way to patch a single line of a function body, so the whole
-- thing is repeated. It is byte-for-byte the version from
-- 20260807000000_matching.sql except for the gate, which now calls
-- matching_access() instead of testing the three conditions inline.
-- ---------------------------------------------------------------------

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

  -- The paywall. Unchanged in substance: the whole condition still lives here
  -- in the open rather than hidden in a policy. The only edit is that the
  -- three-part test moved into matching_access(), so that force-free, the
  -- subscription check and the administrator exception are decided in ONE
  -- place and cannot drift apart between here, match_status() and llm_tier().
  if not public.matching_access(me) then
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
-- 4. The page needs to know WHICH reason let them in
--
-- "subscribed" is no longer the same question as "may use Matching", and the
-- banner depends on the difference: somebody let in by testing mode must be
-- told so, and somebody actually paying must not be told they are testing.
-- ---------------------------------------------------------------------

drop function if exists public.match_status();

create or replace function public.match_status()
returns table (
  enabled boolean, requires_payment boolean, subscribed boolean,
  has_birth_data boolean, has_time boolean, opted_in boolean,
  cipher_count integer, pool integer,
  force_free boolean, paying boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.flag_enabled('matching_enabled', false),
    public.flag_enabled('matching_requires_payment', true),
    -- kept as "may they use it", which is what every caller already asks it
    public.matching_access(auth.uid()),
    exists (select 1 from public.user_birth_data b where b.user_id = auth.uid()),
    exists (select 1 from public.user_birth_data b where b.user_id = auth.uid() and b.birth_time is not null),
    exists (select 1 from public.user_birth_data b where b.user_id = auth.uid() and b.matching_opt_in),
    coalesce((select array_length(p.ciphers, 1) from public.user_cypher_preferences p
               where p.user_id = auth.uid()), 0)::integer,
    (select count(*) from public.user_birth_data b
      where b.user_id <> auth.uid() and b.matching_opt_in)::integer,
    -- new: why they are in
    public.flag_enabled('matching_force_free', false),
    public.subscription_active(auth.uid());
$$;

grant execute on function public.match_status() to authenticated;


-- ---------------------------------------------------------------------
-- 5. "Completely free and unlocked" has to include the readings
--
-- Without this, a tester gets into Matching and then hits the free LLM
-- allowance of three readings a day - which is not unlocked, it is unlocked
-- with a wall three steps further in. Testing mode grants the paid allowance.
--
-- The tier names and the limits table are untouched; only the routing to a
-- tier changes, and only while the flag is on.
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
    -- testing mode: the paid allowance, not the free one
    when public.flag_enabled('matching_force_free', false) then 'paid'
    else 'free'
  end;
$$;

grant execute on function public.llm_tier(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6. What is deliberately NOT bypassed
--
-- Testing mode opens the paywall. It does not open anything else, and the
-- checks below still refuse exactly as they did before:
--
--   * matching_enabled - the master switch still closes Matching for everyone
--   * matching_opt_in  - a member still has to consent to be in the pool, and
--                        still cannot be matched against someone who has not
--   * blocks           - a blocked member is still not a match
--   * account_active   - a suspended account still gets nothing
--   * RLS on user_birth_data - nobody reads anyone else's birth data, ever
--
-- Free mode is a billing state, not a permission state. Consent and privacy
-- are not billing.
-- ---------------------------------------------------------------------
