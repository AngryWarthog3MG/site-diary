-- ============================================================================
-- The programme (README R95): the construction programme as the head
-- contractor issued it, and Kooboolong's own two-week look-aheads.
--
-- A programme is a file the app keeps, never rewrites: each upload is a row;
-- a baseline revision sits beside the one before it (the newest issued is
-- "current"); a look-ahead names the fortnight it covers. A wrong upload is
-- voided with a reason, never deleted. Files live in bucket `programmes`
-- under the job's folder, file first then row, so a refused row leaves a
-- file the keeper may clear and never a row that points at nothing.
--
-- Kept by the supervisor and the office (pm/admin); read by every member of
-- the job — the programme is what the crew works to — behind the record
-- read lock like every other table of the job's.
-- ============================================================================

create table public.project_programmes (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  kind          text not null check (kind in ('baseline', 'lookahead')),
  title         text not null check (length(btrim(title)) > 0),
  revision      text,
  issued_on     date,
  period_start  date,
  period_end    date,
  notes         text,
  file_path     text not null check (length(file_path) > 0),
  content_type  text,
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by   uuid references auth.users (id),
  voided_at     timestamptz,
  void_reason   text,
  created_at    timestamptz not null default now(),
  constraint project_programmes_lookahead_period
    check (kind <> 'lookahead' or (period_start is not null and period_end is not null and period_end >= period_start)),
  constraint project_programmes_void_reason
    check (voided_at is null or length(btrim(coalesce(void_reason, ''))) > 0)
);
create index project_programmes_job_idx on public.project_programmes (project_id, kind, issued_on desc, period_start desc, created_at desc);
comment on table public.project_programmes is
  'The construction programme as issued (baseline, by revision) and the two-week look-aheads. One row per upload; voided, never deleted. README R95.';

create or replace function app.project_programmes_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.title := regexp_replace(btrim(new.title), '\s+', ' ', 'g');
    new.revision := nullif(regexp_replace(btrim(coalesce(new.revision, '')), '\s+', ' ', 'g'), '');
    new.notes := nullif(btrim(coalesce(new.notes, '')), '');
    if split_part(new.file_path, '/', 1) <> new.project_id::text then
      raise exception 'A programme file sits in its own job''s folder.' using errcode = 'check_violation';
    end if;
    -- Born live; the DB stamps who.
    new.voided_at := null; new.void_reason := null;
    new.uploaded_by := coalesce((select auth.uid()), new.uploaded_by);
    new.created_at := now();
  else
    -- The only change a programme takes is being voided, once.
    if new.project_id <> old.project_id or new.kind <> old.kind or new.title <> old.title
       or new.revision is distinct from old.revision or new.issued_on is distinct from old.issued_on
       or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end
       or new.notes is distinct from old.notes or new.file_path <> old.file_path
       or new.content_type is distinct from old.content_type or new.size_bytes is distinct from old.size_bytes
       or new.uploaded_by is distinct from old.uploaded_by or new.created_at <> old.created_at then
      raise exception 'A programme is never rewritten: upload the next revision, or void this one with a reason.' using errcode = 'check_violation';
    end if;
    if old.voided_at is not null then
      raise exception 'This programme is already voided.' using errcode = 'check_violation';
    end if;
    if new.voided_at is null then
      raise exception 'Nothing to change: voiding is the only change a programme takes.' using errcode = 'check_violation';
    end if;
    new.voided_at := now();
    new.void_reason := btrim(new.void_reason);
  end if;
  return new;
end; $$;
create trigger a_project_programmes_before_write before insert or update on public.project_programmes
  for each row execute function app.project_programmes_before_write();
create trigger a_project_programmes_no_delete before delete on public.project_programmes
  for each row execute function app.frozen_row();

-- Who keeps the programme: the supervisor and the office.
create or replace function app.can_keep_programme(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project and pm.user_id = (select auth.uid()) and pm.role::text in ('supervisor', 'pm', 'admin')
  );
$$;
grant execute on function app.can_keep_programme(uuid) to authenticated;

alter table public.project_programmes enable row level security;
create policy project_programmes_select on public.project_programmes for select to authenticated using (app.is_project_member(project_id));
create policy project_programmes_reads_record on public.project_programmes as restrictive for select to authenticated using (app.reads_record(project_id));
create policy project_programmes_insert on public.project_programmes for insert to authenticated with check (app.can_keep_programme(project_id));
create policy project_programmes_update on public.project_programmes for update to authenticated using (app.can_keep_programme(project_id)) with check (app.can_keep_programme(project_id));
grant select, insert, update on public.project_programmes to authenticated;
grant all on public.project_programmes to service_role;

-- The files. Programmes arrive as PDFs, spreadsheets and the odd MS Project file (which browsers send as octet-stream).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('programmes', 'programmes', false, 52428800,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv',
              'application/vnd.ms-project', 'application/octet-stream'])
on conflict (id) do nothing;
create policy "programmes readable by members" on storage.objects
  for select to authenticated
  using (bucket_id = 'programmes' and app.is_project_member(app.storage_project_id(name)) and app.reads_record(app.storage_project_id(name)));
create policy "programmes writable by keepers" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'programmes' and app.can_keep_programme(app.storage_project_id(name)));
-- A file whose row was refused can be cleared by a keeper — only ever a file no programme names.
create policy "programmes unreferenced removable" on storage.objects
  for delete to authenticated
  using (bucket_id = 'programmes'
         and app.can_keep_programme(app.storage_project_id(name))
         and not exists (select 1 from public.project_programmes p where p.file_path = name));
