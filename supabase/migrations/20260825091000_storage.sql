-- ============================================================================
-- 20260825091000_storage.sql
-- Private buckets for raw audio, photos and generated PDFs, with the same
-- project-membership RLS as the tables.
--
-- Path convention, relied on by the policies below:
--   entry-audio   {project_id}/{entry_id}/{filename}
--   entry-photos  {project_id}/{entry_id}/{filename}
--   exports       {project_id}/{filename}
--
-- Uploads to entry-audio / entry-photos are only permitted while the parent
-- entry is the caller's unsigned draft, so a signed entry cannot gain or lose
-- attachments after the fact.
-- ============================================================================

-- Safe path segment -> uuid. Returns null rather than raising on a bad path,
-- so a malformed object name simply fails the policy.
create or replace function app.uuid_or_null(p_text text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

create or replace function app.storage_project_id(p_name text)
returns uuid
language sql
stable
set search_path = ''
as $$ select app.uuid_or_null((storage.foldername(p_name))[1]) $$;

create or replace function app.storage_entry_id(p_name text)
returns uuid
language sql
stable
set search_path = ''
as $$ select app.uuid_or_null((storage.foldername(p_name))[2]) $$;

grant execute on function
  app.uuid_or_null(text),
  app.storage_project_id(text),
  app.storage_entry_id(text)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('entry-audio',  'entry-audio',  false, 52428800,
     array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/aac']),
  ('entry-photos', 'entry-photos', false, 20971520,
     array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  ('exports',      'exports',      false, 52428800,
     array['application/pdf'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- entry-audio and entry-photos
-- ---------------------------------------------------------------------------
create policy "entry media readable by project members" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('entry-audio', 'entry-photos')
    and app.is_project_member(app.storage_project_id(name))
  );

create policy "entry media writable on own draft" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('entry-audio', 'entry-photos')
    and app.is_project_member(app.storage_project_id(name))
    and app.can_write_entry(app.storage_entry_id(name))
  );

create policy "entry media updatable on own draft" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('entry-audio', 'entry-photos')
    and app.can_write_entry(app.storage_entry_id(name))
  )
  with check (
    bucket_id in ('entry-audio', 'entry-photos')
    and app.can_write_entry(app.storage_entry_id(name))
  );

create policy "entry media deletable on own draft" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('entry-audio', 'entry-photos')
    and app.can_write_entry(app.storage_entry_id(name))
  );

-- ---------------------------------------------------------------------------
-- exports — readable by project members, written server-side by service_role
-- ---------------------------------------------------------------------------
create policy "exports readable by project members" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'exports'
    and app.is_project_member(app.storage_project_id(name))
  );
