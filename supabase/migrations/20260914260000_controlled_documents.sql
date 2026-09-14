-- ============================================================================
-- Document control: the company's policies, procedures and plans, versioned,
-- with who has read and understood each version.
--
-- The eighth safety module. A controlled document is one thing with a
-- number; each issue of it is a version with its own file, its summary of
-- what changed, and its date; issuing a version supersedes the one before.
-- People acknowledge a version by name and signature on the supervisor's
-- phone, the way they sign on to a SWMS — once per person per version, so a
-- new version means everyone reads again. Nothing issued or acknowledged is
-- ever edited or removed.
-- ============================================================================

create table public.controlled_documents (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.organisations (id) on delete restrict,
  title                     text not null check (length(btrim(title)) > 0),
  kind                      text not null default 'procedure' check (kind in ('policy', 'procedure', 'plan', 'form', 'other')),
  doc_number                text,
  requires_acknowledgement  boolean not null default true,
  active                    boolean not null default true,
  created_by                uuid references auth.users (id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index controlled_documents_title_idx on public.controlled_documents (org_id, regexp_replace(lower(btrim(title)), '\s+', ' ', 'g'));

create table public.document_versions (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references public.controlled_documents (id) on delete restrict,
  version        integer not null,
  file_path      text not null,
  summary        text,
  status         text not null default 'current' check (status in ('current', 'superseded')),
  issued_at      timestamptz not null default now(),
  issued_by      uuid references auth.users (id),
  superseded_at  timestamptz
);
create unique index document_versions_seq_idx on public.document_versions (document_id, version);
create index document_versions_current_idx on public.document_versions (document_id, status);

create table public.document_acknowledgements (
  id                          uuid primary key default gen_random_uuid(),
  version_id                  uuid not null references public.document_versions (id) on delete restrict,
  person_name                 text not null check (length(btrim(person_name)) > 0),
  signature_path              text not null,
  project_id                  uuid references public.projects (id),
  recorded_by                 uuid not null references auth.users (id),
  acknowledged_on_device_at   timestamptz not null default now(),
  created_at                  timestamptz not null default now()
);
create unique index document_acknowledgements_once_idx
  on public.document_acknowledgements (version_id, regexp_replace(lower(btrim(person_name)), '\s+', ' ', 'g'));

create or replace function app.controlled_documents_touch()
returns trigger language plpgsql set search_path = '' as $$
begin new.title := regexp_replace(btrim(new.title), '\s+', ' ', 'g'); new.doc_number := nullif(btrim(coalesce(new.doc_number, '')), ''); new.updated_at := now(); return new; end; $$;
create trigger a_controlled_documents_touch before insert or update on public.controlled_documents
  for each row execute function app.controlled_documents_touch();

create or replace function app.document_org(p_document uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select org_id from public.controlled_documents where id = p_document; $$;
grant execute on function app.document_org(uuid) to authenticated;

create or replace function app.version_org(p_version uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select d.org_id from public.document_versions v join public.controlled_documents d on d.id = v.document_id where v.id = p_version; $$;
grant execute on function app.version_org(uuid) to authenticated;

-- Issuing a version: numbered under a lock, in its own folder, supersedes the current one.
create or replace function app.document_versions_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  perform pg_advisory_xact_lock(hashtext('docver:' || new.document_id::text));
  select coalesce(max(version), 0) + 1 into new.version from public.document_versions where document_id = new.document_id;
  select org_id into v_org from public.controlled_documents where id = new.document_id;
  if split_part(new.file_path, '/', 1) <> v_org::text or split_part(new.file_path, '/', 2) <> new.document_id::text then
    raise exception 'The file must be stored in this document''s own folder.' using errcode = 'check_violation';
  end if;
  new.status := 'current';
  new.issued_at := now();
  new.superseded_at := null;
  update public.document_versions set status = 'superseded', superseded_at = now()
   where document_id = new.document_id and status = 'current';
  return new;
end; $$;
create trigger a_document_versions_before_insert before insert on public.document_versions
  for each row execute function app.document_versions_before_insert();

create or replace function app.document_versions_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.document_id is distinct from old.document_id or new.version is distinct from old.version
     or new.file_path is distinct from old.file_path or new.summary is distinct from old.summary
     or new.issued_at is distinct from old.issued_at or new.issued_by is distinct from old.issued_by then
    raise exception 'An issued version is frozen; issue a new one.' using errcode = 'check_violation';
  end if;
  if old.status = 'superseded' and new.status = 'current' then
    raise exception 'A superseded version does not come back; issue it again as a new version.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger a_document_versions_before_update before update on public.document_versions
  for each row execute function app.document_versions_before_update();
create trigger a_document_versions_no_delete before delete on public.document_versions
  for each row execute function app.frozen_row();

-- An acknowledgement: of the current version, on a job of the same organisation, signature in its folder.
create or replace function app.document_acknowledgements_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_status text;
begin
  select d.org_id, v.status into v_org, v_status from public.document_versions v join public.controlled_documents d on d.id = v.document_id where v.id = new.version_id;
  if v_org is null then raise exception 'No such version.' using errcode = 'check_violation'; end if;
  if v_status <> 'current' then
    raise exception 'Only the current version is acknowledged; this one is superseded.' using errcode = 'check_violation';
  end if;
  if new.project_id is not null and not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = v_org) then
    raise exception 'The job and the document belong to different organisations.' using errcode = 'check_violation';
  end if;
  new.person_name := regexp_replace(btrim(new.person_name), '\s+', ' ', 'g');
  if split_part(new.signature_path, '/', 1) <> coalesce(new.project_id::text, '') or split_part(new.signature_path, '/', 2) <> 'document'
     or split_part(new.signature_path, '/', 3) <> new.id::text then
    raise exception 'The signature must be stored in this acknowledgement''s own folder.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger a_document_acknowledgements_before_insert before insert on public.document_acknowledgements
  for each row execute function app.document_acknowledgements_before_insert();
create trigger a_document_acknowledgements_frozen before update or delete on public.document_acknowledgements
  for each row execute function app.frozen_row();

alter table public.controlled_documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_acknowledgements enable row level security;

create policy controlled_documents_select_org on public.controlled_documents
  for select to authenticated using (app.is_org_member(org_id));
create policy controlled_documents_write_managers on public.controlled_documents
  for all to authenticated using (app.can_manage_crew(org_id)) with check (app.can_manage_crew(org_id));
create policy document_versions_select_org on public.document_versions
  for select to authenticated using (app.is_org_member(app.document_org(document_id)));
create policy document_versions_insert_managers on public.document_versions
  for insert to authenticated with check (app.can_manage_crew(app.document_org(document_id)));
create policy document_acknowledgements_select_org on public.document_acknowledgements
  for select to authenticated using (app.is_org_member(app.version_org(version_id)));
create policy document_acknowledgements_insert_crew on public.document_acknowledgements
  for insert to authenticated
  with check (recorded_by = (select auth.uid()) and project_id is not null and app.can_run_talks(project_id));

grant select, insert, update on public.controlled_documents to authenticated;
grant select, insert on public.document_versions, public.document_acknowledgements to authenticated;
grant all on public.controlled_documents, public.document_versions, public.document_acknowledgements to service_role;

-- Files: {org_id}/{document_id}/{version_id}.pdf
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('controlled-docs', 'controlled-docs', false, 52428800, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
create policy "controlled docs readable by the organisation" on storage.objects
  for select to authenticated using (bucket_id = 'controlled-docs' and app.is_org_member(((storage.foldername(name))[1])::uuid));
create policy "controlled docs writable by managers" on storage.objects
  for insert to authenticated with check (bucket_id = 'controlled-docs' and app.can_manage_crew(((storage.foldername(name))[1])::uuid));
-- Acknowledgement signatures: {project_id}/document/{ack_id}/sig.png in entry-photos.
create policy "document acknowledgement signatures writable by crew" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'entry-photos' and (storage.foldername(name))[2] = 'document' and app.can_run_talks(((storage.foldername(name))[1])::uuid));
