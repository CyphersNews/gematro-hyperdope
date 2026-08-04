-- =====================================================================
-- Which cipher made a phrase worth publishing
--
-- A published phrase on its own says "this is interesting" without saying
-- why. The cipher and the value it produced are the finding; storing them
-- turns the leaderboard from a list of words into a list of results.
--
-- Both are optional: older rows have neither, and nothing forces a value on
-- a wheel cipher, which has no number to record.
--
-- Safe to re-run.
-- =====================================================================

alter table public.phrase_submissions
  add column if not exists cipher text,
  add column if not exists value  integer;

alter table public.phrase_submissions
  drop constraint if exists phrase_submissions_cipher_len;
alter table public.phrase_submissions
  add constraint phrase_submissions_cipher_len
  check (cipher is null or length(cipher) <= 60);

comment on column public.phrase_submissions.cipher is
  'Cipher the submitter found the phrase interesting in. Null on rows published before this existed.';
comment on column public.phrase_submissions.value is
  'That cipher''s value for the phrase. Null for wheel ciphers, which substitute symbols rather than summing.';

-- ---------------------------------------------------------------------
-- Setup seen
--
-- The welcome page - pick a display name, look over the account, sign out or
-- close it - is worth showing once. Sending someone back through it on every
-- sign-in is just a door in front of the calculator.
--
-- A column rather than localStorage, because "have I done this" should follow
-- the account to a new browser rather than being asked again on each device.
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists setup_done boolean not null default false;

comment on column public.profiles.setup_done is
  'Set once the member has been through the welcome page. Later sign-ins go straight to the calculator.';

-- ---------------------------------------------------------------------
-- Birth chart options
--
-- Which zodiac the chart is read in, and whether the birth time is actually
-- known. An unknown time is worth recording rather than guessing at: without
-- it the houses and the Ascendant are meaningless, and the chart should say
-- so instead of drawing them anyway.
-- ---------------------------------------------------------------------

alter table public.birth_charts
  add column if not exists zodiac text not null default 'tropical',
  add column if not exists time_known boolean not null default true,
  add column if not exists use_place boolean not null default true;

alter table public.birth_charts drop constraint if exists birth_charts_zodiac;
alter table public.birth_charts
  add constraint birth_charts_zodiac check (zodiac in ('tropical', 'sidereal', 'both'));

comment on column public.birth_charts.zodiac is
  'Which zodiac this chart is read in. Both readings are always computable from the same inputs; this is the one to open with.';
comment on column public.birth_charts.time_known is
  'False when the birth time is unknown, in which case houses and the Ascendant are not drawn.';
