-- ---------------------------------------------------------------------
-- A published phrase belongs to whoever published it first
--
-- The leaderboard ranks people by phrases they have published, so the same
-- phrase being claimed by several people makes the ranking meaningless. The
-- original index only stopped one person submitting the same phrase twice;
-- two different people could both publish "Cyphers News", and capitalising it
-- differently slipped past even that.
--
-- Uniqueness is therefore global and case-insensitive, on the trimmed phrase.
-- Enforced here rather than in the client because the client check is only a
-- courtesy: anyone can post straight at the API.
-- ---------------------------------------------------------------------

-- Collapse any duplicates that already exist, keeping the earliest submission
-- of each phrase. Without this the unique index below cannot be created.
delete from public.phrase_submissions a
using public.phrase_submissions b
where lower(btrim(a.phrase)) = lower(btrim(b.phrase))
  and (a.created_at, a.id) > (b.created_at, b.id);

-- the per-user index is now redundant: global uniqueness implies it
drop index if exists public.phrase_submissions_user_phrase_key;

create unique index if not exists phrase_submissions_phrase_key
  on public.phrase_submissions (lower(btrim(phrase)));

comment on index public.phrase_submissions_phrase_key is
  'One published row per phrase, regardless of who submitted it or how it was capitalised.';
