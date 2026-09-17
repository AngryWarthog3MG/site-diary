-- ============================================================================
-- Working as a subcontractor (README R74).
--
-- Kooboolong generally works under a head contractor (Lendlease at Curtin), not
-- as principal contractor and not direct to a client such as Main Roads WA. The
-- duties that shape a subcontractor's records flow DOWN from the head contractor:
--   * incidents are reported up to the head contractor, usually within a time
--     their site rules or the subcontract set — on top of any duty to WorkSafe;
--   * the head contractor holds the site's plans (the WHS management plan under
--     regs 309–313 is the principal contractor's; so usually is the construction
--     environmental management plan, the emergency plan, the traffic management
--     plan and the site rules) and hands them down — a subcontractor needs to
--     show it received the current one and briefed its crew;
--   * a subcontractor's SWMS goes to the head contractor for review before the
--     work starts (the principal contractor must collect them, reg. 312(b)), and
--     comes back accepted or returned.
-- projects.principal_contractor already holds the head contractor's name and
-- projects.is_principal_contractor (off by default) says when Kooboolong IS the
-- principal contractor, in which case none of this flow-down applies.
-- ============================================================================

alter table public.projects
  -- How soon the head contractor must be told of an incident, in hours; null = their rules set none.
  add column head_contractor_incident_hours integer
    check (head_contractor_incident_hours is null or head_contractor_incident_hours between 1 and 168);

-- ---------------------------------------------------------------------------
-- Incidents reported up to the head contractor.
-- ---------------------------------------------------------------------------
create table public.incident_notices (
  id              uuid primary key default gen_random_uuid(),
  incident_id     uuid not null references public.incidents (id) on delete restrict,
  party           text not null default 'head_contractor' check (party in ('head_contractor')),
  notified_at     timestamptz not null,
  method          text not null check (method in ('phone', 'in_person', 'email', 'their_system', 'other')),
  told_by_name    text not null check (length(btrim(told_by_name)) > 0),
  recipient_name  text,
  -- Their incident number, where their system gives one.
  reference       text,
  detail          text,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now()
);
create index incident_notices_idx on public.incident_notices (incident_id, notified_at);

create or replace function app.incident_notices_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.notified_at > now() + interval '10 minutes' then
    raise exception 'That time is in the future.' using errcode = 'check_violation';
  end if;
  new.told_by_name := btrim(new.told_by_name);
  new.recipient_name := nullif(btrim(coalesce(new.recipient_name, '')), '');
  new.reference := nullif(btrim(coalesce(new.reference, '')), '');
  new.detail := nullif(btrim(coalesce(new.detail, '')), '');
  new.created_by := coalesce((select auth.uid()), new.created_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_incident_notices_before_insert before insert on public.incident_notices
  for each row execute function app.incident_notices_before_insert();
create trigger a_incident_notices_no_update before update on public.incident_notices
  for each row execute function app.frozen_row();
create trigger a_incident_notices_no_delete before delete on public.incident_notices
  for each row execute function app.frozen_row();

-- ---------------------------------------------------------------------------
-- The head contractor's plans, as received.
-- ---------------------------------------------------------------------------
create table public.head_contractor_documents (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete restrict,
  kind           text not null check (kind in (
                   'whs_management_plan', 'environmental_management_plan', 'emergency_plan',
                   'traffic_management_plan', 'site_rules', 'induction', 'other')),
  title          text not null check (length(btrim(title)) > 0),
  revision       text,
  received_on    date not null,
  -- {project_id}/{document_id}.{ext} in bucket head-contractor-docs; a copy seen but not kept has none.
  file_path      text,
  -- The only change a received document takes, once: the newer revision that replaced it.
  superseded_by  uuid references public.head_contractor_documents (id) on delete restrict,
  notes          text,
  received_by    uuid references auth.users (id),
  created_at     timestamptz not null default now()
);
create index head_contractor_documents_idx on public.head_contractor_documents (project_id, kind, received_on desc);

create or replace function app.head_contractor_documents_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.received_on > app.perth_today() then
      raise exception 'A document is recorded once it is received.' using errcode = 'check_violation';
    end if;
    if new.file_path is not null and split_part(new.file_path, '/', 1) <> new.project_id::text then
      raise exception 'The file must be in this job''s folder.' using errcode = 'check_violation';
    end if;
    new.superseded_by := null;
    new.title := btrim(new.title);
    new.revision := nullif(btrim(coalesce(new.revision, '')), '');
    new.notes := nullif(btrim(coalesce(new.notes, '')), '');
    new.received_by := coalesce((select auth.uid()), new.received_by);
    new.created_at := now();
    return new;
  end if;
  if old.superseded_by is not null then
    raise exception 'A superseded document is frozen.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - 'superseded_by') is distinct from (to_jsonb(old) - 'superseded_by') then
    raise exception 'A received document does not change; record the newer revision instead.' using errcode = 'check_violation';
  end if;
  if new.superseded_by is not null and not exists (
    select 1 from public.head_contractor_documents d
     where d.id = new.superseded_by and d.project_id = old.project_id and d.kind = old.kind and d.id <> old.id) then
    raise exception 'It is replaced by a newer copy of the same plan on the same job.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger a_head_contractor_documents_before_write before insert or update on public.head_contractor_documents
  for each row execute function app.head_contractor_documents_before_write();
create trigger a_head_contractor_documents_no_delete before delete on public.head_contractor_documents
  for each row execute function app.frozen_row();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('head-contractor-docs', 'head-contractor-docs', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;
create policy "head contractor documents readable by record readers" on storage.objects
  for select to authenticated
  using (bucket_id = 'head-contractor-docs'
         and app.is_project_member(app.storage_project_id(name))
         and app.reads_record(app.storage_project_id(name)));
create policy "head contractor documents writable by managers" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'head-contractor-docs' and app.can_manage_incidents(app.storage_project_id(name)));

-- ---------------------------------------------------------------------------
-- SWMS submitted to the head contractor, and what came back.
-- ---------------------------------------------------------------------------
create table public.swms_reviews (
  id            uuid primary key default gen_random_uuid(),
  swms_id       uuid not null references public.swms (id) on delete restrict,
  kind          text not null check (kind in ('submitted', 'accepted', 'returned')),
  happened_on   date not null,
  person_name   text,
  reference     text,
  comments      text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  constraint swms_review_returned_says_why check (kind <> 'returned' or length(btrim(coalesce(comments, ''))) > 0)
);
create index swms_reviews_idx on public.swms_reviews (swms_id, happened_on, created_at);

-- app.swms_project(uuid) already exists (the SWMS migration): the SWMS row's job.

create or replace function app.swms_reviews_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  select status into st from public.swms where id = new.swms_id;
  if st not in ('draft', 'active') then
    raise exception 'Only a draft or the version in use goes to the head contractor.' using errcode = 'check_violation';
  end if;
  if new.happened_on > app.perth_today() then
    raise exception 'That date is in the future.' using errcode = 'check_violation';
  end if;
  if new.kind in ('accepted', 'returned') and not exists (
    select 1 from public.swms_reviews r where r.swms_id = new.swms_id and r.kind = 'submitted') then
    raise exception 'Record it as submitted first.' using errcode = 'check_violation';
  end if;
  new.person_name := nullif(btrim(coalesce(new.person_name, '')), '');
  new.reference := nullif(btrim(coalesce(new.reference, '')), '');
  new.comments := nullif(btrim(coalesce(new.comments, '')), '');
  new.created_by := coalesce((select auth.uid()), new.created_by);
  new.created_at := clock_timestamp();
  return new;
end; $$;
create trigger a_swms_reviews_before_insert before insert on public.swms_reviews
  for each row execute function app.swms_reviews_before_insert();
create trigger a_swms_reviews_no_update before update on public.swms_reviews
  for each row execute function app.frozen_row();
create trigger a_swms_reviews_no_delete before delete on public.swms_reviews
  for each row execute function app.frozen_row();

-- ---------------------------------------------------------------------------
-- Access: read by those who read the job's record; incident notices by the crew
-- who run the day; plans by supervisors and admins; SWMS reviews by SWMS authors.
-- ---------------------------------------------------------------------------
alter table public.incident_notices enable row level security;
alter table public.head_contractor_documents enable row level security;
alter table public.swms_reviews enable row level security;

create policy incident_notices_select on public.incident_notices for select to authenticated
  using (app.is_project_member(app.regulator_event_project(incident_id)) and app.reads_record(app.regulator_event_project(incident_id)));
create policy incident_notices_insert on public.incident_notices for insert to authenticated
  with check (app.can_run_talks(app.regulator_event_project(incident_id)));

create policy head_contractor_documents_select on public.head_contractor_documents for select to authenticated
  using (app.is_project_member(project_id) and app.reads_record(project_id));
create policy head_contractor_documents_insert on public.head_contractor_documents for insert to authenticated
  with check (app.can_manage_incidents(project_id));
create policy head_contractor_documents_update on public.head_contractor_documents for update to authenticated
  using (app.can_manage_incidents(project_id)) with check (app.can_manage_incidents(project_id));

create policy swms_reviews_select on public.swms_reviews for select to authenticated
  using (app.is_project_member(app.swms_project(swms_id)) and app.reads_record(app.swms_project(swms_id)));
create policy swms_reviews_insert on public.swms_reviews for insert to authenticated
  with check (app.can_write_swms(app.swms_project(swms_id)));

grant select, insert on public.incident_notices, public.swms_reviews to authenticated;
grant select, insert, update on public.head_contractor_documents to authenticated;
grant all on public.incident_notices, public.head_contractor_documents, public.swms_reviews to service_role;
