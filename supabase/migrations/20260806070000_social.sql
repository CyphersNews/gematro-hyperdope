-- =====================================================================
-- Social feed, chat archiving, and richer reports
--
-- THE FEED IS NOT A STATUS BOX
--
-- A post cannot be typed. It is made from a row of the poster's own History
-- Table - the phrase, the cyphers it was read in and the values they gave -
-- plus a caption saying why it is interesting. The only free text is the
-- caption, and it goes through the same filter chat does.
--
-- That constraint is the feature. A box you can type anything into becomes a
-- feed of anything; one that can only carry a decode stays a feed of decodes.
--
-- ARCHIVING AND DELETING ARE PER PERSON
--
-- A conversation has two people in it. Deleting it deletes your copy, not
-- theirs - the alternative lets anyone erase somebody else's messages, and
-- would take the evidence with it the moment a report was filed. Both are a
-- timestamp on your own membership row.
--
-- Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Archiving and clearing a conversation
-- ---------------------------------------------------------------------

alter table public.conversation_members
  add column if not exists archived_at timestamptz,
  add column if not exists cleared_at  timestamptz;

comment on column public.conversation_members.cleared_at is
  'Messages before this are hidden from this member only. The other side keeps theirs, and a report keeps its copy either way.';

grant update (last_read_at, archived_at, cleared_at) on public.conversation_members to authenticated;

create or replace function public.chat_archive(target uuid, on_off boolean default true)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversation_members cm
     set archived_at = case when on_off then now() else null end
   from public.dm_pairs d
  where d.user_a = least(auth.uid(), target)
    and d.user_b = greatest(auth.uid(), target)
    and cm.conversation_id = d.conversation_id
    and cm.user_id = auth.uid();
$$;

-- Clears your side. The other person's copy is untouched, and so is anything
-- already attached to a report.
create or replace function public.chat_clear(target uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversation_members cm
     set cleared_at = now(), archived_at = null
   from public.dm_pairs d
  where d.user_a = least(auth.uid(), target)
    and d.user_b = greatest(auth.uid(), target)
    and cm.conversation_id = d.conversation_id
    and cm.user_id = auth.uid();
$$;

-- history and threads both have to respect cleared_at now
create or replace function public.chat_history(target uuid, lim integer default 100)
returns table (id uuid, sender_id uuid, body text, created_at timestamptz, mine boolean)
language sql stable security definer set search_path = public
as $$
  select m.id, m.sender_id, m.body, m.created_at, (m.sender_id = auth.uid())
  from public.messages m
  join public.dm_pairs d on d.conversation_id = m.conversation_id
  join public.conversation_members cm
    on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
  where d.user_a = least(auth.uid(), target)
    and d.user_b = greatest(auth.uid(), target)
    and (cm.cleared_at is null or m.created_at > cm.cleared_at)
  order by m.created_at desc
  limit least(coalesce(lim, 100), 200);
$$;

drop function if exists public.chat_threads();

create or replace function public.chat_threads(include_archived boolean default false)
returns table (
  friend_id uuid, display_name text, avatar text,
  last_body text, last_at timestamptz, unread integer, archived boolean
)
language sql stable security definer set search_path = public
as $$
  with mine as (
    select cm.conversation_id, cm.last_read_at, cm.archived_at, cm.cleared_at
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
    join mine mi2 on mi2.conversation_id = m.conversation_id
    where mi2.cleared_at is null or m.created_at > mi2.cleared_at
    order by m.conversation_id, m.created_at desc
  )
  select o.user_id, mc.display_name, mc.avatar, lm.body, lm.created_at,
    (select count(*)::int from public.messages m2
      where m2.conversation_id = o.conversation_id
        and m2.sender_id <> auth.uid()
        and m2.created_at > greatest(coalesce(mi.last_read_at, 'epoch'::timestamptz),
                                     coalesce(mi.cleared_at, 'epoch'::timestamptz))),
    (mi.archived_at is not null)
  from other o
  join mine mi on mi.conversation_id = o.conversation_id
  join public.member_cards mc on mc.id = o.user_id
  left join last_msg lm on lm.conversation_id = o.conversation_id
  where not public.is_blocked(auth.uid(), o.user_id)
    and (include_archived or mi.archived_at is null)
  order by lm.created_at desc nulls last;
$$;

create or replace function public.chat_unread_total()
returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(t.unread), 0)::int from public.chat_threads(false) t;
$$;

grant execute on function public.chat_archive(uuid, boolean) to authenticated;
grant execute on function public.chat_clear(uuid) to authenticated;
grant execute on function public.chat_threads(boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 2. Reports: a reason from a list, and what the reporter wants done
-- ---------------------------------------------------------------------

alter table public.reports
  add column if not exists action_requested text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reports_action_check') then
    alter table public.reports add constraint reports_action_check
      check (action_requested is null or action_requested in
        ('review', 'warn', 'investigate', 'other'));
  end if;
end $$;

-- The earlier three- and four-argument versions go, rather than being left
-- alongside this one. Two overloads that both accept {target, reason, detail,
-- message} are ambiguous to PostgREST, and it refuses the call rather than
-- guessing - so the older ones have to be removed, not just superseded.
drop function if exists public.member_report(uuid, text, text);
drop function if exists public.member_report(uuid, text, text, uuid);

create or replace function public.member_report(
  target uuid, reason text, detail text default null,
  message uuid default null, action text default 'review')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  msg public.messages;
begin
  if me is null or target = me then raise exception 'Cannot report yourself'; end if;
  if exists (select 1 from public.reports r
              where r.reporter_id = me and r.reported_id = target
                and r.created_at > now() - interval '1 hour') then
    raise exception 'You have already reported this member recently';
  end if;

  if message is not null then
    select m.* into msg from public.messages m
     where m.id = message
       and exists (select 1 from public.conversation_members cm
                    where cm.conversation_id = m.conversation_id and cm.user_id = me);
    if not found then raise exception 'That message is not one you can see'; end if;
  end if;

  insert into public.reports (reporter_id, reported_id, reason, detail,
                              message_id, conversation_id, message_body, action_requested)
  values (me, target, reason, detail, msg.id, msg.conversation_id, msg.body,
          coalesce(nullif(action, ''), 'review'));
end;
$$;

grant execute on function public.member_report(uuid, text, text, uuid, text) to authenticated;

-- the panel shows what was asked for alongside what was said
drop function if exists public.admin_reports(text, text, integer);

create or replace function public.admin_reports(
  status_filter text default null, sort text default 'newest', lim integer default 100)
returns table (
  id uuid, created_at timestamptz, status text,
  reporter_id uuid, reporter_name text,
  reported_id uuid, reported_name text,
  reason text, detail text, action_requested text,
  message_id uuid, message_body text, conversation_id uuid,
  handled_by_name text, handled_at timestamptz, admin_note text
)
language sql stable security definer set search_path = public
as $$
  select r.id, r.created_at, r.status,
         r.reporter_id,
         (select coalesce(pr.username, pr.discord_username, 'Anonymous') from public.profiles pr where pr.id = r.reporter_id),
         r.reported_id,
         (select coalesce(pd.username, pd.discord_username, 'Anonymous') from public.profiles pd where pd.id = r.reported_id),
         r.reason, r.detail, r.action_requested,
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


-- ---------------------------------------------------------------------
-- 3. The feed
--
-- readings is jsonb rather than columns because a decode is interesting for
-- more than one cypher at a time, and a post pinned to a single cypher column
-- could not say "this is 74 in three of them", which is the whole point.
-- ---------------------------------------------------------------------

create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  phrase     text not null,
  readings   jsonb not null default '[]'::jsonb,
  caption    text,
  created_at timestamptz not null default now(),
  constraint posts_phrase_len  check (length(btrim(phrase)) between 1 and 200),
  constraint posts_caption_len check (caption is null or length(caption) <= 400),
  constraint posts_readings_shape check (jsonb_typeof(readings) = 'array'
                                    and jsonb_array_length(readings) between 1 and 8)
);

create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_user_idx on public.posts (user_id, created_at desc);

create table if not exists public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_likes_post_idx on public.post_likes (post_id);

alter table public.posts enable row level security;
alter table public.post_likes enable row level security;

-- Reading the feed is the point, so select is open to members. Writing is not:
-- posts go through post_create(), which runs the caption past the same filter
-- chat uses. A direct insert would be a way to publish text that never met it.
drop policy if exists "posts_select_all" on public.posts;
create policy "posts_select_all" on public.posts for select to authenticated using ( true );

drop policy if exists "posts_delete_own" on public.posts;
create policy "posts_delete_own" on public.posts for delete to authenticated
  using ( user_id = (select auth.uid()) );

drop policy if exists "likes_select_all" on public.post_likes;
create policy "likes_select_all" on public.post_likes for select to authenticated using ( true );

drop policy if exists "likes_insert_own" on public.post_likes;
create policy "likes_insert_own" on public.post_likes for insert to authenticated
  with check ( user_id = (select auth.uid()) and public.account_active((select auth.uid())) );

drop policy if exists "likes_delete_own" on public.post_likes;
create policy "likes_delete_own" on public.post_likes for delete to authenticated
  using ( user_id = (select auth.uid()) );

revoke all on public.posts, public.post_likes from anon, authenticated;
grant select, delete on public.posts to authenticated;
grant select, insert, delete on public.post_likes to authenticated;
-- no insert on posts: post_create() is the only writer


create or replace function public.post_create(
  phrase text, readings jsonb, caption text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  chk record;
  n   integer;
  new_id uuid;
  clean_caption text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  perform public.account_check(me);

  if jsonb_typeof(readings) <> 'array' or jsonb_array_length(readings) = 0 then
    raise exception 'Pick at least one cypher to share it in';
  end if;

  clean_caption := nullif(btrim(coalesce(caption, '')), '');

  -- The phrase and the caption are both public text, so both meet the filter.
  -- The phrase especially: it is chosen by the poster and would otherwise be a
  -- way to publish anything at all, one word at a time.
  select * into chk from public.mod_check(phrase);
  if not chk.ok then
    insert into public.moderation_events (user_id, category, reason, action, length)
      values (me, chk.category, chk.note, 'rejected', length(phrase));
    raise exception 'Not posted — %', coalesce(chk.note, 'that phrase broke a rule');
  end if;

  if clean_caption is not null then
    select * into chk from public.mod_check(clean_caption);
    if not chk.ok then
      insert into public.moderation_events (user_id, category, reason, action, length)
        values (me, chk.category, chk.note, 'rejected', length(clean_caption));
      raise exception 'Not posted — %', coalesce(chk.note, 'that caption broke a rule');
    end if;
  end if;

  select count(*) into n from public.posts p
   where p.user_id = me and p.created_at > now() - interval '1 hour';
  if n >= 10 then raise exception 'That is a lot of posts in an hour — try again shortly'; end if;

  if exists (select 1 from public.posts p
              where p.user_id = me and p.phrase = btrim(phrase)
                and p.created_at > now() - interval '1 day') then
    raise exception 'You shared that one today already';
  end if;

  insert into public.posts (user_id, phrase, readings, caption)
  values (me, btrim(phrase), readings, clean_caption)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.feed_list(
  scope text default 'all', lim integer default 30, off integer default 0)
returns table (
  id uuid, author_id uuid, author_name text, author_avatar text, author_admin boolean,
  phrase text, readings jsonb, caption text, created_at timestamptz,
  likes integer, liked boolean, mine boolean
)
language sql stable security definer set search_path = public
as $$
  select p.id, p.user_id, mc.display_name, mc.avatar,
         coalesce((select pr.is_admin from public.profiles pr where pr.id = p.user_id), false),
         p.phrase, p.readings, p.caption, p.created_at,
         (select count(*)::int from public.post_likes l where l.post_id = p.id),
         exists (select 1 from public.post_likes l2 where l2.post_id = p.id and l2.user_id = auth.uid()),
         (p.user_id = auth.uid())
  from public.posts p
  join public.member_cards mc on mc.id = p.user_id
  where not public.is_blocked(auth.uid(), p.user_id)
    and case scope
      when 'mine'    then p.user_id = auth.uid()
      -- friends only: the same list the Friends tab shows, plus your own
      when 'friends' then p.user_id = auth.uid() or public.are_friends(auth.uid(), p.user_id)
      else true
    end
  order by
    case when scope = 'top' then (select count(*) from public.post_likes l3 where l3.post_id = p.id) end desc,
    p.created_at desc
  limit least(coalesce(lim, 30), 100) offset greatest(coalesce(off, 0), 0);
$$;

create or replace function public.post_like(post uuid, on_off boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if on_off then
    insert into public.post_likes (post_id, user_id) values (post, me)
      on conflict do nothing;
  else
    delete from public.post_likes l where l.post_id = post and l.user_id = me;
  end if;
  return (select count(*)::int from public.post_likes l2 where l2.post_id = post);
end;
$$;

revoke all on function public.post_create(text, jsonb, text) from anon, authenticated;
grant execute on function public.post_create(text, jsonb, text) to authenticated;
grant execute on function public.feed_list(text, integer, integer) to authenticated;
grant execute on function public.post_like(uuid, boolean) to authenticated;


-- =====================================================================
-- Ready for, and deliberately not built
--
--   Comments      a post_comments table with the same shape as post_likes,
--                 its body through mod_check() exactly as the caption is.
--   Sharing       a reshare is a post with a parent_id; the column can be
--                 added without touching anything here.
--   Images        posts.image_url plus a storage bucket scoped the way avatars
--                 already are. The moderation question an image raises is not
--                 one a word filter can answer, which is why it is not here.
--   Trending      feed_list already takes a scope; 'trending' is one more
--                 branch of that case, over likes in a window.
-- =====================================================================
