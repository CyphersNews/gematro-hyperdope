-- =====================================================================
-- Phrase submissions and the contributor leaderboard
--
-- Submission is explicit and per phrase. Saving a phrase to your history is
-- private; publishing one is a separate, deliberate act. Nothing a user
-- decodes becomes visible to anyone else unless they submit it.
--
-- Safe to re-run.
-- =====================================================================

create table if not exists public.phrase_submissions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  phrase      text not null,
  created_at  timestamptz not null default now(),
  constraint phrase_submissions_not_blank check (length(btrim(phrase)) > 0),
  constraint phrase_submissions_len check (length(phrase) <= 500)
);

comment on table public.phrase_submissions is
  'Phrases a user has deliberately published. Opt-in, one row per submission.';

-- the same phrase cannot be submitted twice by the same person
create unique index if not exists phrase_submissions_user_phrase_key
  on public.phrase_submissions (user_id, phrase);

create index if not exists phrase_submissions_user_idx
  on public.phrase_submissions (user_id);
create index if not exists phrase_submissions_created_idx
  on public.phrase_submissions (created_at desc);

-- ---------------------------------------------------------------------
-- Row Level Security
--
-- Reads are open to any signed-in user, because that is the point of
-- publishing. Writes are restricted to the owner: you may only submit as
-- yourself, and only withdraw your own submissions.
-- ---------------------------------------------------------------------

alter table public.phrase_submissions enable row level security;

drop policy if exists "submissions_select_all" on public.phrase_submissions;
create policy "submissions_select_all"
  on public.phrase_submissions for select
  to authenticated
  using ( true );

drop policy if exists "submissions_insert_own" on public.phrase_submissions;
create policy "submissions_insert_own"
  on public.phrase_submissions for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists "submissions_delete_own" on public.phrase_submissions;
create policy "submissions_delete_own"
  on public.phrase_submissions for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- no update policy: a submission is withdrawn and re-made, not silently edited

revoke all on public.phrase_submissions from anon, authenticated;
grant select, insert, delete on public.phrase_submissions to authenticated;

-- ---------------------------------------------------------------------
-- Public contributor identity
--
-- profiles holds the email, and its RLS restricts every row to its owner. The
-- leaderboard needs to show other people's names, so rather than loosening
-- that policy this exposes a deliberately narrow view.
--
-- The view is security definer (the default for views), which is what lets it
-- read profiles past that RLS. That is only safe because of what it selects:
-- id, display name and avatar. Email is never referenced. If you ever add a
-- sensitive column to profiles, it stays invisible here unless it is added to
-- this select list on purpose.
-- ---------------------------------------------------------------------

create or replace view public.public_profiles as
  select
    p.id,
    coalesce(p.username, p.discord_username, 'Anonymous') as display_name,
    coalesce(p.avatar_url, p.discord_avatar)              as avatar
  from public.profiles p;

comment on view public.public_profiles is
  'Non-sensitive contributor identity. Deliberately excludes email.';

revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to authenticated;

-- ---------------------------------------------------------------------
-- Leaderboard
--
-- Aggregated over submissions only, so it can never surface a phrase that was
-- not published. Ranked by submission count.
-- ---------------------------------------------------------------------

create or replace view public.leaderboard as
  select
    pp.id            as user_id,
    pp.display_name,
    pp.avatar,
    count(s.id)      as submissions,
    max(s.created_at) as last_submission
  from public.public_profiles pp
  join public.phrase_submissions s on s.user_id = pp.id
  group by pp.id, pp.display_name, pp.avatar
  order by count(s.id) desc, max(s.created_at) desc;

comment on view public.leaderboard is
  'Contributor ranking by submitted phrase count. Usernames only, no emails.';

revoke all on public.leaderboard from anon, authenticated;
grant select on public.leaderboard to authenticated;
