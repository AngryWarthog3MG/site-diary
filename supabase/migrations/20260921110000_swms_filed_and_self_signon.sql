-- ============================================================================
-- A SWMS you already have, and signing on to it from your own phone (README R89).
--
-- Two gaps, one breath. The app could only WRITE a method statement, step by
-- step, and a subcontractor's SWMS is usually a document already — from a
-- consultant, from the head contractor's template — so it had no way in. And
-- a sign-on was recorded by whoever runs the talks, every signature drawn on
-- the supervisor's phone; a labourer could not open a SWMS at all, let alone
-- read it and put their own name to it.
--
-- So:
--   * `swms.file_path` — the document itself, in bucket `swms-docs`
--     `{project}/{swms}.{ext}`. A filed SWMS is complete on its own terms:
--     the document IS the method statement, and `swms_problems` asks nothing
--     more of it. Like every other content column it is frozen once the
--     SWMS is in use.
--   * `app.can_sign_own_swms` — any member of the job may sign on to an
--     ACTIVE SWMS as themselves: the attendee name must be the name on their
--     own profile (R70), so a labourer can sign for nobody but themselves.
--     Whoever runs the talks still signs the crew on as before.
--   * A member reads an active SWMS on their job whatever their role — a
--     worker must be able to read what they are signing (WHS Regs r. 299,
--     r. 300) — and their own sign-on; drafts and old versions keep the
--     record lock.
-- ============================================================================

alter table public.swms
  add column file_path text,
  add column file_name text;

-- The document is the method statement; nothing else is asked of a filed SWMS.
create or replace function app.swms_problems(p public.swms)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_problems text[] := '{}';
  v_step jsonb;
  v_n integer := 0;
begin
  if p.file_path is not null then
    return '{}';
  end if;
  if jsonb_typeof(p.steps) <> 'array' or jsonb_array_length(p.steps) = 0 then
    v_problems := v_problems || 'no steps';
  else
    for v_step in select * from jsonb_array_elements(p.steps) loop
      v_n := v_n + 1;
      if length(btrim(coalesce(v_step ->> 'step', ''))) = 0 then v_problems := v_problems || format('step %s has no description', v_n); end if;
      if length(btrim(coalesce(v_step ->> 'hazards', ''))) = 0 then v_problems := v_problems || format('step %s names no hazard', v_n); end if;
      if length(btrim(coalesce(v_step ->> 'controls', ''))) = 0 then v_problems := v_problems || format('step %s has no control', v_n); end if;
    end loop;
  end if;
  if p.kind = 'swms' and coalesce(array_length(p.hrcw, 1), 0) = 0 then
    v_problems := v_problems || 'a SWMS must name its high-risk construction work';
  end if;
  if length(btrim(coalesce(p.prepared_by, ''))) = 0 then
    v_problems := v_problems || 'nobody is named as having prepared it';
  end if;
  return v_problems;
end;
$$;

-- The file lives in the SWMS's own folder, and is as frozen as the rest once in use.
create or replace function app.swms_file_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.file_path is not null and position(new.project_id::text || '/' in new.file_path) <> 1 then
    raise exception 'The document must be stored in this job''s own folder.' using errcode = 'check_violation';
  end if;
  new.file_name := nullif(btrim(coalesce(new.file_name, '')), '');
  if tg_op = 'UPDATE' and old.status <> 'draft'
     and (new.file_path is distinct from old.file_path or new.file_name is distinct from old.file_name) then
    raise exception 'A SWMS in use is not changed; a revision is a new version.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger b_swms_file_guard before insert or update on public.swms
  for each row execute function app.swms_file_guard();

-- Signing on as yourself: the SWMS is in use, you are on its job, and the name is your own.
create or replace function app.can_sign_own_swms(p_swms uuid, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.swms s
      join public.profiles pr on pr.id = (select auth.uid())
     where s.id = p_swms
       and s.status = 'active'
       and app.is_project_member(s.project_id)
       and pr.full_name is not null
       and lower(regexp_replace(btrim(pr.full_name), '\s+', ' ', 'g'))
         = lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
  );
$$;
grant execute on function app.can_sign_own_swms(uuid, text) to authenticated;

-- A member of the job, while the SWMS is in use — for putting a signature file in its folder.
create or replace function app.is_swms_member_active(p_swms uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.swms s
     where s.id = p_swms and s.status = 'active' and app.is_project_member(s.project_id)
  );
$$;
grant execute on function app.is_swms_member_active(uuid) to authenticated;

drop policy if exists swms_signons_insert_crew on public.swms_signons;
create policy swms_signons_insert_crew on public.swms_signons
  for insert to authenticated
  with check (
    (app.can_sign_swms(swms_id) or app.can_sign_own_swms(swms_id, attendee_name))
    and created_by = (select auth.uid())
  );

-- Reads: an active SWMS is every member's to read; drafts and old versions keep the record lock.
drop policy if exists swms_reads_record on public.swms;
create policy swms_reads_record on public.swms as restrictive for select to authenticated
  using (app.reads_record(project_id) or (status = 'active' and app.is_project_member(project_id)));

-- And your own sign-on is yours to see.
drop policy if exists swms_signons_reads_record on public.swms_signons;
create policy swms_signons_reads_record on public.swms_signons as restrictive for select to authenticated
  using (
    created_by = (select auth.uid())
    or exists (select 1 from public.swms s where s.id = swms_id and app.reads_record(s.project_id))
  );

-- The signature file: whoever may sign the crew on, or any member while it is in use.
drop policy if exists "swms signatures writable while in use" on storage.objects;
create policy "swms signatures writable while in use" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-photos'
    and (storage.foldername(name))[2] = 'swms'
    and (app.can_sign_swms(((storage.foldername(name))[3])::uuid)
         or app.is_swms_member_active(((storage.foldername(name))[3])::uuid))
    and (storage.foldername(name))[1] = app.swms_project(((storage.foldername(name))[3])::uuid)::text
  );

-- ---------------------------------------------------------------------------
-- The filed documents: {project_id}/{swms_id}.{ext}. Readable by every member
-- of the job — a worker reads what they sign. Written by whoever writes SWMS.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('swms-docs', 'swms-docs', false, 52428800,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

create policy "swms documents readable by members" on storage.objects
  for select to authenticated
  using (bucket_id = 'swms-docs' and app.is_project_member(app.storage_project_id(name)));
create policy "swms documents writable by authors" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'swms-docs' and app.can_write_swms(app.storage_project_id(name)));
-- A file whose row was refused can be cleared by an author — only ever a file no SWMS names.
create policy "swms documents unreferenced removable" on storage.objects
  for delete to authenticated
  using (bucket_id = 'swms-docs'
         and app.can_write_swms(app.storage_project_id(name))
         and not exists (select 1 from public.swms s where s.file_path = name));
