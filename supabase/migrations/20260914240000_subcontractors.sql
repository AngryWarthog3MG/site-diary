-- ============================================================================
-- Subcontractor compliance: the companies on the job and their paperwork.
--
-- The sixth safety module. The organisation keeps each subcontractor once —
-- name, ABN, contact — with its documents: public liability, workers'
-- compensation, its SWMS, licences, safety plan, each with an expiry. A job
-- engages a subcontractor for a period. The app decides, from the dates
-- alone, whether a subcontractor is compliant, expiring or lapsed, and says
-- so on the register when someone from that company signs in at the gate.
-- Documents are records: a superseded certificate is retired, never deleted.
-- ============================================================================

create table public.subcontractors (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations (id) on delete restrict,
  name           text not null check (length(btrim(name)) > 0),
  abn            text,
  contact_name   text,
  contact_phone  text,
  contact_email  text,
  trade          text,
  notes          text,
  active         boolean not null default true,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index subcontractors_org_name_idx on public.subcontractors (org_id, regexp_replace(lower(btrim(name)), '\s+', ' ', 'g'));

create table public.subcontractor_documents (
  id                uuid primary key default gen_random_uuid(),
  subcontractor_id  uuid not null references public.subcontractors (id) on delete restrict,
  kind              text not null check (kind in ('public_liability', 'workers_comp', 'swms', 'licence', 'insurance_other', 'safety_plan', 'induction', 'other')),
  title             text not null check (length(btrim(title)) > 0),
  reference         text,
  issued_on         date,
  expires_on        date,
  file_path         text,
  notes             text,
  active            boolean not null default true,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  constraint subcontractor_documents_dates check (issued_on is null or expires_on is null or expires_on >= issued_on)
);
create index subcontractor_documents_idx on public.subcontractor_documents (subcontractor_id, active, expires_on);

create table public.project_subcontractors (
  project_id        uuid not null references public.projects (id) on delete restrict,
  subcontractor_id  uuid not null references public.subcontractors (id) on delete restrict,
  scope             text,
  engaged_from      date,
  engaged_to        date,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  primary key (project_id, subcontractor_id)
);

create or replace function app.subcontractors_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  new.abn := nullif(regexp_replace(coalesce(new.abn, ''), '\s+', '', 'g'), '');
  new.updated_at := now();
  return new;
end; $$;
create trigger a_subcontractors_touch before insert or update on public.subcontractors
  for each row execute function app.subcontractors_touch();

-- A document's facts are fixed once recorded; it is retired, not rewritten.
create or replace function app.subcontractor_documents_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.subcontractor_id is distinct from old.subcontractor_id or new.kind is distinct from old.kind
     or new.title is distinct from old.title or new.reference is distinct from old.reference
     or new.issued_on is distinct from old.issued_on or new.expires_on is distinct from old.expires_on
     or new.file_path is distinct from old.file_path or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'A document is retired and replaced, not rewritten.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger a_subcontractor_documents_before_update before update on public.subcontractor_documents
  for each row execute function app.subcontractor_documents_before_update();
create trigger a_subcontractor_documents_no_delete before delete on public.subcontractor_documents
  for each row execute function app.frozen_row();

-- Who may keep the subcontractor register: whoever keeps the crew register.
create or replace function app.subcontractor_org(p_subcontractor uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select org_id from public.subcontractors where id = p_subcontractor; $$;
grant execute on function app.subcontractor_org(uuid) to authenticated;

alter table public.subcontractors enable row level security;
alter table public.subcontractor_documents enable row level security;
alter table public.project_subcontractors enable row level security;

create policy subcontractors_select_org on public.subcontractors
  for select to authenticated using (app.is_org_member(org_id));
create policy subcontractors_write_managers on public.subcontractors
  for all to authenticated using (app.can_manage_crew(org_id)) with check (app.can_manage_crew(org_id));

create policy subcontractor_documents_select_org on public.subcontractor_documents
  for select to authenticated using (app.is_org_member(app.subcontractor_org(subcontractor_id)));
create policy subcontractor_documents_insert_managers on public.subcontractor_documents
  for insert to authenticated with check (app.can_manage_crew(app.subcontractor_org(subcontractor_id)));
create policy subcontractor_documents_retire_managers on public.subcontractor_documents
  for update to authenticated using (app.can_manage_crew(app.subcontractor_org(subcontractor_id))) with check (app.can_manage_crew(app.subcontractor_org(subcontractor_id)));

create policy project_subcontractors_select_member on public.project_subcontractors
  for select to authenticated using (app.is_project_member(project_id));
create policy project_subcontractors_write_managers on public.project_subcontractors
  for all to authenticated using (app.can_manage_incidents(project_id)) with check (app.can_manage_incidents(project_id));

grant select, insert, update on public.subcontractors, public.subcontractor_documents to authenticated;
grant select, insert, update, delete on public.project_subcontractors to authenticated;
grant all on public.subcontractors, public.subcontractor_documents, public.project_subcontractors to service_role;

-- Certificates and licences: {org_id}/{subcontractor_id}/{document_id}.{ext}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('subcontractor-docs', 'subcontractor-docs', false, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;
create policy "subcontractor docs readable by the organisation" on storage.objects
  for select to authenticated
  using (bucket_id = 'subcontractor-docs' and app.is_org_member(((storage.foldername(name))[1])::uuid));
create policy "subcontractor docs writable by crew managers" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'subcontractor-docs' and app.can_manage_crew(((storage.foldername(name))[1])::uuid));
