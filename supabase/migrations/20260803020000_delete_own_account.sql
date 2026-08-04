-- =====================================================================
-- Closing your account
--
-- A member must be able to leave and take their email with them. Deleting a
-- row in auth.users is an admin operation, and the key that can do it is the
-- service_role key, which must never reach the browser. The alternative to
-- shipping that key is this: a security definer function that deletes exactly
-- one row - the caller's own - and cannot be pointed at anyone else, because
-- it takes no arguments and reads the id from the verified JWT.
--
-- Everything else follows automatically. profiles, history_entries,
-- workspaces, presets and phrase_submissions all reference auth.users (id)
-- on delete cascade, so the account's data goes with it. Uploaded avatars do
-- not have a foreign key, so they are removed here explicitly.
--
-- This is irreversible. There is no soft delete and nothing is retained.
--
-- Safe to re-run.
-- =====================================================================

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  -- storage has no cascade back to auth.users, so the user's avatar folder is
  -- cleared by hand. Files live under a folder named for the uid.
  delete from storage.objects
   where bucket_id = 'avatars'
     and (storage.foldername(name))[1] = uid::text;

  -- the cascades on every application table hang off this one row
  delete from auth.users where id = uid;
end;
$$;

comment on function public.delete_own_account() is
  'Permanently deletes the calling user and all of their data. Takes no arguments: the id comes from the JWT, so it can only ever delete the caller.';

-- Only a signed-in user may call it, and only for themselves.
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
