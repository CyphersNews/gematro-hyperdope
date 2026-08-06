-- =====================================================================
-- Safe friends chat, phase 1
--
-- THE ONE THING THAT MATTERS ARCHITECTURALLY
--
-- public.messages has no insert policy. None. The only way a row gets in is
-- public.chat_send(), which is security definer and runs every check first.
-- A filter that runs in the browser is a suggestion - anyone can open the
-- console and call the insert directly - so none of the rules below live
-- there. The client filter that ships alongside this is there to give a fast
-- answer, not to enforce anything.
--
-- HOW RULES ARE ADDED
--
-- Rules are rows in public.mod_rules, not code. Adding a banned term, a new
-- grooming phrase or a new pattern is an INSERT. Nothing in the chat system
-- changes, which is the future-proofing this was asked for.
--
-- WHAT THIS CANNOT DO
--
-- Keyword and pattern matching catches the careless and the casual. It does
-- not catch someone determined and articulate, and it never will - abuse can
-- be spelled correctly and phrased politely. The AI stage exists for that and
-- is wired but off; see mod_settings.require_ai and the notes at the bottom.
-- This is a floor, not a ceiling, and it is not a substitute for someone
-- reading reports.
--
-- Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Blocking
--
-- Directional: blocking someone is a statement about what you want to see,
-- not a punishment applied to them. Both directions are checked everywhere
-- that matters, so a block stops contact whichever way round it was made.
-- ---------------------------------------------------------------------

create table if not exists public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

drop policy if exists "blocks_select_own" on public.blocks;
create policy "blocks_select_own"
  on public.blocks for select to authenticated
  using ( (select auth.uid()) = blocker_id );

drop policy if exists "blocks_insert_own" on public.blocks;
create policy "blocks_insert_own"
  on public.blocks for insert to authenticated
  with check ( (select auth.uid()) = blocker_id );

drop policy if exists "blocks_delete_own" on public.blocks;
create policy "blocks_delete_own"
  on public.blocks for delete to authenticated
  using ( (select auth.uid()) = blocker_id );

revoke all on public.blocks from anon, authenticated;
grant select, insert, delete on public.blocks to authenticated;

-- Deliberately not visible to the blocked party: they can see it in the sense
-- that contact stops working, but never as "X blocked you".
create or replace function public.is_blocked(u1 uuid, u2 uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = u1 and b.blocked_id = u2)
       or (b.blocker_id = u2 and b.blocked_id = u1)
  );
$$;


-- ---------------------------------------------------------------------
-- 2. Reporting
--
-- Insert-only, exactly like the contact inbox: a member can file one and can
-- never read anyone's, including their own. Reading happens in the Supabase
-- dashboard, by a person.
-- ---------------------------------------------------------------------

create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references auth.users (id) on delete cascade,
  reported_id  uuid not null references auth.users (id) on delete cascade,
  reason       text not null,
  detail       text,
  created_at   timestamptz not null default now(),
  constraint reports_not_self check (reporter_id <> reported_id),
  constraint reports_reason_len check (length(reason) between 1 and 60),
  constraint reports_detail_len check (detail is null or length(detail) <= 1000)
);

create index if not exists reports_reported_idx on public.reports (reported_id, created_at desc);

alter table public.reports enable row level security;

drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own"
  on public.reports for insert to authenticated
  with check ( (select auth.uid()) = reporter_id );

-- no select policy at all, on purpose

revoke all on public.reports from anon, authenticated;
grant insert on public.reports to authenticated;


-- ---------------------------------------------------------------------
-- 3. Moderation: normalisation
--
-- Evasion is mostly typography. "f u c k", "f.u.c.k", "fuuuck" and "fvck" are
-- the same message, so the text is folded before any rule sees it:
--
--   lower case  ->  leet folded  ->  runs of 3+ collapsed  ->  separators
--
-- Two forms come out of that, because they fail in opposite directions:
--
--   words  keeps separators as spaces, matched with word boundaries. Accurate,
--          but "f.u.c.k" slips through.
--   tight  removes separators entirely, matched as a substring. Catches that,
--          but "Scunthorpe" contains a banned word and so does "classic".
--
-- Which is why mod_allow exists: known-innocent words are removed before the
-- tight form is built, so they cannot trip a substring rule. That list is the
-- maintenance burden of doing it this way, and it is the right burden - the
-- alternative is either missing obvious evasion or blocking real words.
-- ---------------------------------------------------------------------

create table if not exists public.mod_allow (
  word text primary key
);

comment on table public.mod_allow is
  'Innocent words removed before substring matching, so Scunthorpe can be typed.';

insert into public.mod_allow (word) values
  ('scunthorpe'),('penistone'),('lightwater'),('clbuttic'),
  ('assassin'),('assassinate'),('assassination'),('assess'),('assessment'),
  ('asset'),('assets'),('assign'),('assignment'),('assist'),('assistant'),
  ('associate'),('association'),('assume'),('assumption'),('assure'),
  ('bass'),('brass'),('class'),('classic'),('classical'),('compass'),
  ('embassy'),('glass'),('grass'),('harass'),('mass'),('massive'),('pass'),
  ('passage'),('passion'),('password'),('potassium'),('surpass'),('sassafras'),
  ('cocktail'),('peacock'),('hancock'),('shuttlecock'),('cockney'),('cockpit'),
  ('analysis'),('analyst'),('analytic'),('analytical'),('canal'),('banal'),
  ('title'),('titles'),('constitute'),('constitution'),('institute'),
  ('document'),('documents'),('button'),('buttons'),('butter'),('shuttle'),
  ('therapist'),('therapists'),('specialist'),('mishit'),('shiitake'),
  ('dickens'),('dickinson'),('haddock'),('paddock'),('hitchcock')
on conflict (word) do nothing;

-- lower, leet-folded, long runs collapsed, separators as single spaces
create or replace function public.mod_norm_words(t text)
returns text
language sql immutable
as $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        translate(lower(coalesce(t, '')), '4310$!@57', 'aeiosiast'),
      '[^a-z0-9]+', ' ', 'g'),
    '(.)\1{2,}', '\1', 'g'),
  '\s+', ' ', 'g'));
$$;

-- the same, with the innocent words dropped and every separator removed
create or replace function public.mod_norm_tight(t text)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(string_agg(w, ''), '')
  from unnest(string_to_array(public.mod_norm_words(t), ' ')) as w
  where w <> '' and w not in (select word from public.mod_allow);
$$;


-- ---------------------------------------------------------------------
-- 4. Moderation: the rules
--
-- kind:
--   word   matched on the spaced form, whole word. For short terms where a
--          substring match would be a disaster.
--   tight  matched as a substring of the separator-stripped form. For terms
--          long enough that a substring hit is almost certainly deliberate.
--   regex  matched case-insensitively against the raw text. For shapes -
--          phone numbers, emails, coordinates - rather than vocabulary.
-- ---------------------------------------------------------------------

create table if not exists public.mod_rules (
  id       serial primary key,
  category text not null,
  kind     text not null,
  pattern  text not null,
  enabled  boolean not null default true,
  note     text,
  constraint mod_rules_kind check (kind in ('word', 'tight', 'regex')),
  constraint mod_rules_category check (category in
    ('profanity', 'hate', 'sexual', 'contact', 'personal', 'age', 'bullying', 'link'))
);

create unique index if not exists mod_rules_pattern_key on public.mod_rules (kind, pattern);
create index if not exists mod_rules_enabled_idx on public.mod_rules (enabled) where enabled;

comment on table public.mod_rules is
  'The whole filter. Adding a rule is an INSERT; no code changes with it.';

-- ---- shapes: links, addresses, numbers -------------------------------
insert into public.mod_rules (category, kind, pattern, note) values
  ('link','regex','https?://', 'links are not allowed'),
  ('link','regex','www\.[a-z0-9-]+', 'links are not allowed'),
  ('link','regex','[a-z0-9-]+\.(com|net|org|co\.uk|io|me|gg|ly|xyz|info|biz|tv|link|site|app)\M', 'links are not allowed'),
  ('link','regex','<[a-z/][^>]*>', 'HTML is not allowed'),
  ('personal','regex','[a-z0-9._%+-]+\s*(@|\(at\)|\[at\]|\sat\s)\s*[a-z0-9.-]+\s*(\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,}', 'email addresses are not allowed'),
  ('personal','regex','(\+?\d[\s().-]?){9,}', 'phone numbers are not allowed'),
  ('personal','regex','\m0\d{3}[\s-]?\d{6,7}\M', 'phone numbers are not allowed'),
  ('personal','regex','\m[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\M', 'postcodes are not allowed'),
  ('personal','regex','\m\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}\M', 'coordinates are not allowed'),
  ('personal','regex','\m\d{1,4}\s+[a-z]+\s+(road|rd|street|st|avenue|ave|lane|ln|drive|dr|close|court|crescent|way)\M', 'addresses are not allowed'),
  ('personal','regex','\m[A-Z]{2}\d{6}[A-Z]?\M', 'ID numbers are not allowed'),
  ('personal','regex','\m\d{3}[\s-]?\d{2}[\s-]?\d{4}\M', 'ID numbers are not allowed')
on conflict (kind, pattern) do nothing;

-- ---- moving the conversation off the site ----------------------------
insert into public.mod_rules (category, kind, pattern, note) values
  ('contact','tight','whatsapp',   'keep it here rather than moving to another app'),
  ('contact','tight','telegram',   'keep it here rather than moving to another app'),
  ('contact','tight','snapchat',   'keep it here rather than moving to another app'),
  ('contact','tight','instagram',  'keep it here rather than moving to another app'),
  ('contact','tight','facebook',   'keep it here rather than moving to another app'),
  ('contact','tight','tiktok',     'keep it here rather than moving to another app'),
  ('contact','tight','discordapp', 'keep it here rather than moving to another app'),
  ('contact','tight','kikmessenger','keep it here rather than moving to another app'),
  ('contact','word','snap',        'keep it here rather than moving to another app'),
  ('contact','word','kik',         'keep it here rather than moving to another app'),
  ('contact','word','wickr',       'keep it here rather than moving to another app'),
  ('contact','word','signal',      'keep it here rather than moving to another app'),
  ('contact','word','discord',     'keep it here rather than moving to another app'),
  ('contact','tight','textme',     'personal contact details are not allowed'),
  ('contact','tight','callme',     'personal contact details are not allowed'),
  ('contact','tight','ringme',     'personal contact details are not allowed'),
  ('contact','tight','dmme',       'personal contact details are not allowed'),
  ('contact','tight','addmeon',    'personal contact details are not allowed'),
  ('contact','tight','meetme',     'arranging to meet is not allowed here'),
  ('contact','tight','meetup',     'arranging to meet is not allowed here'),
  ('contact','tight','meetinperson','arranging to meet is not allowed here'),
  ('contact','tight','wheredoyoulive', 'personal details are not allowed'),
  ('contact','tight','whereareyoufrom', 'personal details are not allowed'),
  ('contact','tight','whatsyouraddress', 'personal details are not allowed'),
  ('contact','tight','sendyouraddress',  'personal details are not allowed'),
  ('contact','tight','whatschool',       'personal details are not allowed'),
  ('contact','tight','whatschooldoyougoto','personal details are not allowed'),
  ('contact','tight','yourphonenumber',  'personal details are not allowed'),
  ('contact','tight','yournumber',       'personal details are not allowed'),
  ('contact','tight','whatsyournumber',  'personal details are not allowed')
on conflict (kind, pattern) do nothing;

-- ---- age ------------------------------------------------------------
insert into public.mod_rules (category, kind, pattern, note) values
  ('age','tight','howoldareyou',   'age is not something to exchange here'),
  ('age','tight','whatsyourage',   'age is not something to exchange here'),
  ('age','tight','whatisyourage',  'age is not something to exchange here'),
  ('age','tight','yourbirthday',   'age is not something to exchange here'),
  ('age','tight','whenisyourbirthday','age is not something to exchange here'),
  ('age','tight','whenwereyouborn','age is not something to exchange here'),
  ('age','tight','whatyearwereyouborn','age is not something to exchange here'),
  ('age','tight','whatyearareyouin','age is not something to exchange here'),
  ('age','tight','whatschoolyear', 'age is not something to exchange here'),
  ('age','tight','graduationyear', 'age is not something to exchange here'),
  ('age','tight','areyouover18',   'age is not something to exchange here'),
  ('age','tight','areyouunder18',  'age is not something to exchange here')
on conflict (kind, pattern) do nothing;

-- ---- sexual ---------------------------------------------------------
insert into public.mod_rules (category, kind, pattern, note) values
  ('sexual','tight','porn',      'that is not allowed here'),
  ('sexual','tight','pornhub',   'that is not allowed here'),
  ('sexual','tight','xxx',       'that is not allowed here'),
  ('sexual','tight','nudes',     'that is not allowed here'),
  ('sexual','tight','sendnudes', 'that is not allowed here'),
  ('sexual','tight','sendpics',  'that is not allowed here'),
  ('sexual','tight','sendpic',   'that is not allowed here'),
  ('sexual','tight','naked',     'that is not allowed here'),
  ('sexual','tight','sexting',   'that is not allowed here'),
  ('sexual','tight','sexy',      'that is not allowed here'),
  ('sexual','tight','horny',     'that is not allowed here'),
  ('sexual','tight','blowjob',   'that is not allowed here'),
  ('sexual','tight','handjob',   'that is not allowed here'),
  ('sexual','tight','masturbat', 'that is not allowed here'),
  ('sexual','tight','orgasm',    'that is not allowed here'),
  ('sexual','tight','ejacul',    'that is not allowed here'),
  ('sexual','tight','fetish',    'that is not allowed here'),
  ('sexual','tight','bdsm',      'that is not allowed here'),
  ('sexual','tight','hentai',    'that is not allowed here'),
  ('sexual','tight','onlyfans',  'that is not allowed here'),
  ('sexual','tight','camgirl',   'that is not allowed here'),
  ('sexual','tight','escort',    'that is not allowed here'),
  ('sexual','word','sex',        'that is not allowed here'),
  ('sexual','word','cum',        'that is not allowed here'),
  ('sexual','word','tits',       'that is not allowed here'),
  ('sexual','word','boobs',      'that is not allowed here'),
  ('sexual','word','dildo',      'that is not allowed here'),
  ('sexual','word','anal',       'that is not allowed here'),
  ('sexual','word','penis',      'that is not allowed here'),
  ('sexual','word','vagina',     'that is not allowed here')
on conflict (kind, pattern) do nothing;

-- ---- profanity ------------------------------------------------------
insert into public.mod_rules (category, kind, pattern, note) values
  ('profanity','tight','fuck',    'keep it civil'),
  ('profanity','tight','shit',    'keep it civil'),
  ('profanity','tight','bitch',   'keep it civil'),
  ('profanity','tight','bastard', 'keep it civil'),
  ('profanity','tight','wanker',  'keep it civil'),
  ('profanity','tight','bollock', 'keep it civil'),
  ('profanity','tight','arsehole','keep it civil'),
  ('profanity','tight','asshole', 'keep it civil'),
  ('profanity','tight','motherfucker','keep it civil'),
  ('profanity','tight','cunt',    'keep it civil'),
  ('profanity','tight','prick',   'keep it civil'),
  ('profanity','tight','twat',    'keep it civil'),
  ('profanity','tight','slut',    'keep it civil'),
  ('profanity','tight','whore',   'keep it civil'),
  ('profanity','word','arse',     'keep it civil'),
  ('profanity','word','ass',      'keep it civil'),
  ('profanity','word','crap',     'keep it civil'),
  ('profanity','word','dick',     'keep it civil'),
  ('profanity','word','cock',     'keep it civil'),
  ('profanity','word','piss',     'keep it civil'),
  ('profanity','word','damn',     'keep it civil'),
  ('profanity','word','bugger',   'keep it civil')
on conflict (kind, pattern) do nothing;

-- ---- hate speech and slurs ------------------------------------------
-- Deliberately substring rules: these have no innocent use, so a partial hit
-- is worth acting on. Extend this list; it is not close to complete.
insert into public.mod_rules (category, kind, pattern, note) values
  ('hate','tight','nigger',  'that language is not allowed here'),
  ('hate','tight','nigga',   'that language is not allowed here'),
  ('hate','tight','faggot',  'that language is not allowed here'),
  ('hate','word','fag',      'that language is not allowed here'),
  ('hate','tight','tranny',  'that language is not allowed here'),
  ('hate','tight','retard',  'that language is not allowed here'),
  ('hate','tight','spastic', 'that language is not allowed here'),
  ('hate','tight','paki',    'that language is not allowed here'),
  ('hate','tight','chink',   'that language is not allowed here'),
  ('hate','tight','gook',    'that language is not allowed here'),
  ('hate','tight','wetback', 'that language is not allowed here'),
  ('hate','tight','kike',    'that language is not allowed here'),
  ('hate','tight','gypo',    'that language is not allowed here'),
  ('hate','tight','coon',    'that language is not allowed here'),
  ('hate','tight','dyke',    'that language is not allowed here'),
  ('hate','tight','heil',    'that language is not allowed here'),
  ('hate','tight','whitepower', 'that language is not allowed here'),
  ('hate','tight','gaschamber', 'that language is not allowed here')
on conflict (kind, pattern) do nothing;

-- ---- threats and targeted abuse -------------------------------------
insert into public.mod_rules (category, kind, pattern, note) values
  ('bullying','tight','killyourself', 'that is not allowed here'),
  ('bullying','tight','killurself',   'that is not allowed here'),
  ('bullying','tight','kys',          'that is not allowed here'),
  ('bullying','tight','illkillyou',   'threats are not allowed here'),
  ('bullying','tight','imgoingtokill','threats are not allowed here'),
  ('bullying','tight','iwillfindyou', 'threats are not allowed here'),
  ('bullying','tight','iknowwhereyoulive','threats are not allowed here'),
  ('bullying','tight','watchyourback','threats are not allowed here'),
  ('bullying','tight','youshoulddie', 'that is not allowed here'),
  ('bullying','tight','hangyourself', 'that is not allowed here'),
  ('bullying','tight','nobodylikesyou','that is not allowed here'),
  ('bullying','tight','worthless',    'that is not allowed here'),
  ('bullying','tight','uglyfreak',    'that is not allowed here')
on conflict (kind, pattern) do nothing;

revoke all on public.mod_rules from anon, authenticated;
revoke all on public.mod_allow from anon, authenticated;
-- nobody reads the rule list from the client: knowing the filter exactly is
-- most of the work of getting round it


-- ---------------------------------------------------------------------
-- 5. Moderation: the check
--
-- Returns the first rule that fires. First rather than all of them, because
-- the sender is told one reason and telling them every rule they broke is a
-- tutorial in what the filter looks for.
-- ---------------------------------------------------------------------

create or replace function public.mod_check(body text)
returns table (ok boolean, category text, note text)
language plpgsql stable security definer set search_path = public
as $$
declare
  w text := public.mod_norm_words(body);
  t text := public.mod_norm_tight(body);
  r record;
begin
  for r in
    select * from public.mod_rules where enabled
    -- shapes before vocabulary: "call me on 07700 900123" should be reported
    -- as a phone number, which is the useful half
    order by case category when 'personal' then 0 when 'link' then 1
                           when 'contact' then 2 when 'age' then 3 else 4 end, id
  loop
    if r.kind = 'word' then
      if w ~ ('(^| )' || r.pattern || '( |$)') then
        return query select false, r.category, r.note; return;
      end if;
    elsif r.kind = 'tight' then
      if t like '%' || r.pattern || '%' then
        return query select false, r.category, r.note; return;
      end if;
    else
      if body ~* r.pattern then
        return query select false, r.category, r.note; return;
      end if;
    end if;
  end loop;
  return query select true, null::text, null::text;
end;
$$;


-- ---------------------------------------------------------------------
-- 6. Moderation log
--
-- The event, never the message. A rejected message is not stored anywhere:
-- keeping the text of what was blocked would mean building a searchable
-- archive of the worst things anyone has typed, which is the opposite of the
-- point. What is kept is enough to spot a pattern - who, when, which rule.
-- ---------------------------------------------------------------------

create table if not exists public.moderation_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  category   text not null,
  reason     text,
  action     text not null default 'rejected',
  length     integer
);

create index if not exists moderation_events_user_idx
  on public.moderation_events (user_id, created_at desc);
create index if not exists moderation_events_created_idx
  on public.moderation_events (created_at desc);

comment on table public.moderation_events is
  'One row per rejection. Never contains the rejected text.';

alter table public.moderation_events enable row level security;
-- no policies: written by security definer functions, read in the dashboard
revoke all on public.moderation_events from anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. Conversations and messages
--
-- Modelled as a conversation with members rather than a pair of user ids,
-- even though phase 1 only ever makes two-person ones. Group chat later is
-- then a different `kind` and a third row in conversation_members, not a
-- migration of every message ever sent.
-- ---------------------------------------------------------------------

create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'dm',
  created_at timestamptz not null default now(),
  constraint conversations_kind check (kind in ('dm', 'group'))
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz,
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id);

-- One dm per pair, found the same canonical way friendships are.
create table if not exists public.dm_pairs (
  user_a          uuid not null references auth.users (id) on delete cascade,
  user_b          uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  primary key (user_a, user_b),
  constraint dm_pairs_ordered check (user_a < user_b)
);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references auth.users (id) on delete cascade,
  body            text not null,
  created_at      timestamptz not null default now(),
  constraint messages_len check (length(body) between 1 and 500)
);

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists messages_sender_recent_idx
  on public.messages (sender_id, created_at desc);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.dm_pairs enable row level security;
alter table public.messages enable row level security;

drop policy if exists "conversations_select_mine" on public.conversations;
create policy "conversations_select_mine"
  on public.conversations for select to authenticated
  using ( exists (
    select 1 from public.conversation_members m
    where m.conversation_id = conversations.id and m.user_id = (select auth.uid())
  ) );

drop policy if exists "conv_members_select_mine" on public.conversation_members;
create policy "conv_members_select_mine"
  on public.conversation_members for select to authenticated
  using ( exists (
    select 1 from public.conversation_members m2
    where m2.conversation_id = conversation_members.conversation_id
      and m2.user_id = (select auth.uid())
  ) );

-- marking your own side read is the only direct write anywhere in here
drop policy if exists "conv_members_update_own" on public.conversation_members;
create policy "conv_members_update_own"
  on public.conversation_members for update to authenticated
  using ( user_id = (select auth.uid()) )
  with check ( user_id = (select auth.uid()) );

drop policy if exists "messages_select_mine" on public.messages;
create policy "messages_select_mine"
  on public.messages for select to authenticated
  using ( exists (
    select 1 from public.conversation_members m
    where m.conversation_id = messages.conversation_id and m.user_id = (select auth.uid())
  ) );

-- You may unsend your own message. There is no update policy: an edited
-- message would have passed the filter as one thing and be readable as
-- another.
drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own"
  on public.messages for delete to authenticated
  using ( sender_id = (select auth.uid()) );

-- NO INSERT POLICY. chat_send() is the only writer. This is the line that
-- makes every rule above enforceable rather than advisory.

revoke all on public.conversations, public.conversation_members,
              public.dm_pairs, public.messages from anon, authenticated;
grant select on public.conversations, public.conversation_members, public.messages to authenticated;
grant update (last_read_at) on public.conversation_members to authenticated;


-- ---------------------------------------------------------------------
-- 8. Settings
-- ---------------------------------------------------------------------

create table if not exists public.mod_settings (
  id          boolean primary key default true,
  require_ai  boolean not null default false,
  max_len     integer not null default 500,
  per_minute  integer not null default 10,
  dupe_window integer not null default 60,
  constraint mod_settings_one_row check (id)
);

insert into public.mod_settings (id) values (true) on conflict (id) do nothing;

comment on column public.mod_settings.require_ai is
  'When true, chat_send only accepts calls from service_role - which forces every message through the Edge Function, and therefore through the AI check. Off by default so chat works before that is deployed.';

revoke all on public.mod_settings from anon, authenticated;


-- ---------------------------------------------------------------------
-- 9. Sending
--
-- The whole pipeline, in the order that gives the sender the most useful
-- refusal: are you allowed to talk to this person at all, is the message a
-- sensible size, are you flooding, and only then what it says.
-- ---------------------------------------------------------------------

create or replace function public.chat_conversation_with_pair(me uuid, target uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  lo uuid := least(me, target);
  hi uuid := greatest(me, target);
  cid uuid;
begin
  select conversation_id into cid from public.dm_pairs where user_a = lo and user_b = hi;
  if cid is not null then return cid; end if;

  insert into public.conversations (kind) values ('dm') returning id into cid;
  insert into public.conversation_members (conversation_id, user_id) values (cid, lo), (cid, hi);
  insert into public.dm_pairs (user_a, user_b, conversation_id) values (lo, hi, cid)
    on conflict (user_a, user_b) do nothing;

  -- lost the race: use the row that won
  select conversation_id into cid from public.dm_pairs where user_a = lo and user_b = hi;
  return cid;
end;
$$;

-- The pipeline itself, with the sender passed in rather than assumed.
--
-- Both entry points below funnel through this, and it runs every check every
-- time - including the rules the Edge Function has already run. Checking twice
-- costs a few milliseconds and means the rules apply no matter who is calling
-- or what they claim to have done already.
create or replace function public.chat_send_core(me uuid, target uuid, body text)
returns table (id uuid, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  cfg  public.mod_settings;
  chk  record;
  cid  uuid;
  n    integer;
  clean text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into cfg from public.mod_settings where id;

  if not public.are_friends(me, target) then
    raise exception 'You can only message friends';
  end if;
  if public.is_blocked(me, target) then
    raise exception 'You cannot message this member';
  end if;

  -- Control characters out, runs of blank lines squeezed, ends trimmed. Not a
  -- filter - just stopping a message being made of whitespace and cursor
  -- tricks. Line breaks survive, because they are allowed.
  clean := btrim(regexp_replace(regexp_replace(coalesce(body, ''),
             '[^\S\r\n]+', ' ', 'g'), '(\r?\n){3,}', E'\n\n', 'g'));

  if length(clean) = 0 then raise exception 'Nothing to send'; end if;
  if length(clean) > cfg.max_len then
    raise exception 'Too long — % characters at most', cfg.max_len;
  end if;

  -- flooding
  select count(*) into n from public.messages
   where sender_id = me and created_at > now() - interval '1 minute';
  if n >= cfg.per_minute then
    insert into public.moderation_events (user_id, category, reason, action, length)
      values (me, 'spam', 'rate limit', 'rejected', length(clean));
    raise exception 'Slow down a moment — too many messages';
  end if;

  -- the same thing again
  if exists (
    select 1 from public.messages m
    where m.sender_id = me and m.body = clean
      and m.created_at > now() - make_interval(secs => cfg.dupe_window)
  ) then
    raise exception 'You have just sent that';
  end if;

  select * into chk from public.mod_check(clean);
  if not chk.ok then
    insert into public.moderation_events (user_id, category, reason, action, length)
      values (me, chk.category, chk.note, 'rejected', length(clean));
    raise exception 'Message not sent — %', coalesce(chk.note, 'it broke a chat rule');
  end if;

  cid := public.chat_conversation_with_pair(me, target);
  return query
    insert into public.messages (conversation_id, sender_id, body)
    values (cid, me, clean)
    returning messages.id, messages.created_at;
end;
$$;

-- What the browser calls.
--
-- The require_ai gate lives here rather than in the core, so that turning the
-- AI stage on closes this door and leaves chat_send_as open. Nothing else has
-- to change to make the switch.
create or replace function public.chat_send(target uuid, body text)
returns table (id uuid, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare cfg public.mod_settings;
begin
  select * into cfg from public.mod_settings where id;
  if cfg.require_ai then
    raise exception 'Messages must go through moderation';
  end if;
  return query select * from public.chat_send_core(auth.uid(), target, body);
end;
$$;

-- What the Edge Function calls, once it has run the AI check.
--
-- Restricted to service_role by grant, not by a check inside: a function
-- nobody can execute is a stronger guarantee than one that decides not to.
create or replace function public.chat_send_as(sender uuid, target uuid, body text)
returns table (id uuid, created_at timestamptz)
language sql security definer set search_path = public
as $$
  select * from public.chat_send_core(sender, target, body);
$$;


-- ---------------------------------------------------------------------
-- 10. Reading
-- ---------------------------------------------------------------------

create or replace function public.chat_history(target uuid, lim integer default 100)
returns table (id uuid, sender_id uuid, body text, created_at timestamptz, mine boolean)
language sql stable security definer set search_path = public
as $$
  select m.id, m.sender_id, m.body, m.created_at, (m.sender_id = auth.uid())
  from public.messages m
  join public.dm_pairs d on d.conversation_id = m.conversation_id
  where d.user_a = least(auth.uid(), target)
    and d.user_b = greatest(auth.uid(), target)
    and exists (select 1 from public.conversation_members cm
                 where cm.conversation_id = m.conversation_id and cm.user_id = auth.uid())
  order by m.created_at desc
  limit least(coalesce(lim, 100), 200);
$$;

-- Every conversation you are in, newest first, with what is unread.
create or replace function public.chat_threads()
returns table (
  friend_id uuid, display_name text, avatar text,
  last_body text, last_at timestamptz, unread integer
)
language sql stable security definer set search_path = public
as $$
  with mine as (
    select cm.conversation_id, cm.last_read_at
    from public.conversation_members cm where cm.user_id = auth.uid()
  ),
  other as (
    select cm.conversation_id, cm.user_id
    from public.conversation_members cm
    where cm.user_id <> auth.uid()
      and cm.conversation_id in (select conversation_id from mine)
  ),
  last_msg as (
    select distinct on (m.conversation_id) m.conversation_id, m.body, m.created_at
    from public.messages m
    where m.conversation_id in (select conversation_id from mine)
    order by m.conversation_id, m.created_at desc
  )
  select o.user_id, mc.display_name, mc.avatar, lm.body, lm.created_at,
    (select count(*)::int from public.messages m2
      where m2.conversation_id = o.conversation_id
        and m2.sender_id <> auth.uid()
        and m2.created_at > coalesce(mi.last_read_at, 'epoch'::timestamptz))
  from other o
  join mine mi on mi.conversation_id = o.conversation_id
  join public.member_cards mc on mc.id = o.user_id
  left join last_msg lm on lm.conversation_id = o.conversation_id
  where not public.is_blocked(auth.uid(), o.user_id)
  order by lm.created_at desc nulls last;
$$;

create or replace function public.chat_mark_read(target uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.conversation_members cm
     set last_read_at = now()
   from public.dm_pairs d
  where d.user_a = least(auth.uid(), target)
    and d.user_b = greatest(auth.uid(), target)
    and cm.conversation_id = d.conversation_id
    and cm.user_id = auth.uid();
$$;

create or replace function public.chat_unread_total()
returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(unread), 0)::int from public.chat_threads();
$$;


-- ---------------------------------------------------------------------
-- 11. Blocking and reporting, as verbs
-- ---------------------------------------------------------------------

-- Blocking removes the friendship too: staying friends with someone you have
-- blocked is a state with no meaning, and leaving it would show them in your
-- friends list for ever with nothing you can do to them.
create or replace function public.member_block(target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null or target = me then raise exception 'Cannot block yourself'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (me, target)
    on conflict do nothing;
  delete from public.friendships
   where user_a = least(me, target) and user_b = greatest(me, target);
end;
$$;

create or replace function public.member_unblock(target uuid)
returns void
language sql security definer set search_path = public
as $$
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = target;
$$;

create or replace function public.member_report(target uuid, reason text, detail text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null or target = me then raise exception 'Cannot report yourself'; end if;
  if exists (select 1 from public.reports
              where reporter_id = me and reported_id = target
                and created_at > now() - interval '1 hour') then
    raise exception 'You have already reported this member recently';
  end if;
  insert into public.reports (reporter_id, reported_id, reason, detail)
  values (me, target, reason, detail);
end;
$$;

create or replace function public.member_blocked_list()
returns table (id uuid, display_name text, avatar text, since timestamptz)
language sql stable security definer set search_path = public
as $$
  select mc.id, mc.display_name, mc.avatar, b.created_at
  from public.blocks b join public.member_cards mc on mc.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc;
$$;


-- ---------------------------------------------------------------------
-- 12. Blocks reach back into the friends system
--
-- These replace the versions in 20260806000000_friends.sql. A blocked member
-- cannot be found, cannot be suggested, and cannot ask to be friends.
-- ---------------------------------------------------------------------

create or replace function public.friend_can_request(viewer uuid, target uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when public.is_blocked(viewer, target) then false
    else case (select p.friend_policy from public.profiles p where p.id = target)
      when 'nobody' then false
      when 'friends_of_friends' then public.friend_mutual_count(viewer, target) > 0
      else true
    end
  end;
$$;

create or replace function public.member_search(q text, lim integer default 20)
returns table (
  id uuid, display_name text, username text, avatar text,
  joined_at timestamptz, last_active_at timestamptz,
  state text, mutuals integer
)
language sql stable security definer set search_path = public
as $$
  select m.id, m.display_name, m.username, m.avatar, m.joined_at,
         case when m.show_online then m.last_active_at end,
         public.friend_state(auth.uid(), m.id),
         case when m.show_mutuals then public.friend_mutual_count(auth.uid(), m.id) else 0 end
  from public.member_cards m
  where (m.public_profile or m.id = auth.uid())
    and not public.is_blocked(auth.uid(), m.id)
    and length(btrim(coalesce(q, ''))) > 0
    and (m.display_name ilike '%' || btrim(q) || '%'
         or coalesce(m.username, '') ilike '%' || btrim(q) || '%')
  order by
    case when m.display_name ilike btrim(q) || '%' then 0 else 1 end,
    m.display_name
  limit least(coalesce(lim, 20), 50);
$$;


-- ---------------------------------------------------------------------
-- 13. Grants
-- ---------------------------------------------------------------------

revoke all on function public.mod_check(text) from anon, authenticated;
revoke all on function public.mod_norm_words(text) from anon, authenticated;
revoke all on function public.mod_norm_tight(text) from anon, authenticated;
revoke all on function public.chat_conversation_with_pair(uuid, uuid) from anon, authenticated;
-- chat_send_as is granted to nobody here: service_role bypasses grants, and
-- withholding it from authenticated is what stops a browser naming its own sender
revoke all on function public.chat_send_as(uuid, uuid, text) from anon, authenticated;
revoke all on function public.chat_send_core(uuid, uuid, text) from anon, authenticated;

grant execute on function public.chat_send(uuid, text) to authenticated;
grant execute on function public.chat_history(uuid, integer) to authenticated;
grant execute on function public.chat_threads() to authenticated;
grant execute on function public.chat_mark_read(uuid) to authenticated;
grant execute on function public.chat_unread_total() to authenticated;
grant execute on function public.member_block(uuid) to authenticated;
grant execute on function public.member_unblock(uuid) to authenticated;
grant execute on function public.member_report(uuid, text, text) to authenticated;
grant execute on function public.member_blocked_list() to authenticated;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;


-- =====================================================================
-- The AI stage
--
-- mod_settings.require_ai is false, so phase 1 runs on rules alone and works
-- the moment this migration is applied.
--
-- To turn the AI stage on:
--   1. Deploy supabase/functions/moderate-message (see its README).
--   2. Set the provider key as a secret on the function.
--   3. update public.mod_settings set require_ai = true;
--
-- After step 3 chat_send refuses every caller that is not service_role, so
-- the browser can no longer reach it and the Edge Function becomes the only
-- way a message can be stored. Nothing in the chat system changes to make
-- that switch - which is the point of putting the gate here rather than in
-- the client.
--
-- Adding rules without touching any of this:
--   insert into public.mod_rules (category, kind, pattern, note)
--   values ('contact', 'tight', 'newapp', 'keep it here');
-- =====================================================================
