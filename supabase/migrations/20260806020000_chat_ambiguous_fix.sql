-- =====================================================================
-- Fix: "column reference ... is ambiguous" when sending a message
--
-- In PL/pgSQL, the columns named in RETURNS TABLE are variables for the whole
-- function body. chat_send and chat_send_core both return (id, created_at), so
-- inside them the bare word `id` means two things:
--
--     select * into cfg from public.mod_settings where id;
--                                                     ^^ the OUT parameter,
--                                                        or the column?
--
-- Postgres refuses to guess, which is the error that came back. The same trap
-- caught `created_at` in the rate-limit query, and `category` in mod_check,
-- which returns (ok, category, note).
--
-- Nothing here changes behaviour. Every reference is simply qualified with the
-- table it belongs to, and the tables are aliased so there is no way to write
-- an unqualified column by accident.
--
-- Four references across three functions. Fixing only the one in the error
-- would have moved the failure to the next line rather than mended it: the
-- order they are hit in is chat_send -> chat_send_core -> mod_check.
--
-- Safe to re-run. Signatures are unchanged, so create or replace is enough and
-- no grants need repeating.
-- =====================================================================


-- 1. mod_check: `category` was the OUT parameter and the column
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
    select mr.* from public.mod_rules mr where mr.enabled
    -- shapes before vocabulary: "call me on 07700 900123" should be reported
    -- as a phone number, which is the useful half
    order by case mr.category when 'personal' then 0 when 'link' then 1
                              when 'contact' then 2 when 'age' then 3 else 4 end, mr.id
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


-- 2. chat_send_core: `id` in the settings lookup, `created_at` in the rate limit
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
  select s.* into cfg from public.mod_settings s where s.id;

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
  select count(*) into n from public.messages fm
   where fm.sender_id = me and fm.created_at > now() - interval '1 minute';
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


-- 3. chat_send: the same settings lookup, the same collision
create or replace function public.chat_send(target uuid, body text)
returns table (id uuid, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare cfg public.mod_settings;
begin
  select s.* into cfg from public.mod_settings s where s.id;
  if cfg.require_ai then
    raise exception 'Messages must go through moderation';
  end if;
  return query select * from public.chat_send_core(auth.uid(), target, body);
end;
$$;


-- =====================================================================
-- If you add a PL/pgSQL function that RETURNS TABLE, qualify every column in
-- its body. The names in that clause are variables, and an unqualified column
-- that happens to match one is an error at call time, not at create time -
-- which is why this got as far as being typed into a chat box before anyone
-- found out.
-- =====================================================================
