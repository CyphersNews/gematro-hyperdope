-- =====================================================================
-- Custom profile pictures
--
-- Until now only Discord users had an avatar, because it came from the OAuth
-- provider. This adds an uploaded one, available to every signed-in user.
--
-- Safe to re-run.
-- =====================================================================

-- Kept separate from discord_avatar so the two never overwrite each other:
-- a user can upload a picture and still have their Discord one on record.
-- The app prefers avatar_url when both exist.
alter table public.profiles
  add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is
  'Uploaded profile picture. Takes precedence over discord_avatar.';

-- ---------------------------------------------------------------------
-- Storage bucket
--
-- Public read so an <img src> works without a signed URL, which also means
-- avatars must be treated as public: never put anything private in here.
-- Writes are locked down below.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,  -- 2 MB, enforced by storage itself rather than trusting the client
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- Storage policies
--
-- Every object lives under a folder named after the owner's uid, and these
-- policies pin writes to that folder. storage.foldername() splits the path, so
-- [1] is the first segment. A user therefore cannot write over anybody else's
-- avatar even though the bucket is world-readable.
-- ---------------------------------------------------------------------

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  to public
  using ( bucket_id = 'avatars' );

drop policy if exists "avatars_insert_own_folder" on storage.objects;
create policy "avatars_insert_own_folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_update_own_folder" on storage.objects;
create policy "avatars_update_own_folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_delete_own_folder" on storage.objects;
create policy "avatars_delete_own_folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
