-- ============================================================================
-- Construction work records: the principal contractor's WHS management plan,
-- and the excavation record for underground services and trenches.
--
-- WHS (General) Regulations 2022 (WA), Chapter 6:
--
--   reg. 292 — in WA a "construction project" is defined by CREW SIZE: five or
--     more persons working at the same time at the site. Not the $250,000 test
--     in the model regulations and NSW; a secondary source that says otherwise
--     for WA is contradicted by the primary text (README R59, entry 06).
--   regs 309–313 — the principal contractor for a construction project must
--     prepare a written WHS management plan BEFORE work commences, inform
--     everyone who carries out construction work of it, review and revise it,
--     and keep it — every revised version — until the project is completed, and
--     for at least 2 years after a notifiable incident.
--   reg. 304 — before excavation, take all reasonable steps to obtain current
--     underground essential services information, have regard to it, make it
--     readily available to workers and others, and retain it until the work is
--     completed (longer if there is a notifiable incident).
--   reg. 306 — a trench at least 1.5 m deep is secured against collapse by
--     benching, battering or shoring, unless a geotechnical engineer has advised
--     in writing that the area is not at risk of collapse.
--
-- The excavation PERMIT already asks "Dial Before You Dig plans current;
-- services located and potholed" as a tick. A tick is not the information reg.
-- 304 says to keep: the reference, when it was obtained, what it showed, the
-- plans, and who located the services. That is this record. A permit can point
-- at it; the permit is not changed.
--
-- Nothing here is ever deleted, which is how reg. 303's and reg. 313's
-- retention is met: there is no purge to get wrong. The conditional two-year
-- extension after a notifiable incident needs no code while nothing expires.
-- ============================================================================

-- Whether this company is the principal contractor on the job. Off by default:
-- most of a subcontractor's jobs are someone else's project.
alter table public.projects add column if not exists is_principal_contractor boolean not null default false;
comment on column public.projects.is_principal_contractor is
  'reg. 293: the company is the principal contractor for this construction project, and so holds the WHS management plan (regs 309–313).';

create table public.whs_management_plans (
  id                         uuid primary key default gen_random_uuid(),
  project_id                 uuid not null references public.projects (id) on delete restrict,
  version                    integer not null,
  -- reg. 310(1): what the plan must include.
  responsibilities           text not null check (length(btrim(responsibilities)) > 0),
  consultation_arrangements  text not null check (length(btrim(consultation_arrangements)) > 0),
  incident_arrangements      text not null check (length(btrim(incident_arrangements)) > 0),
  site_rules                 text not null check (length(btrim(site_rules)) > 0),
  swms_arrangements          text not null check (length(btrim(swms_arrangements)) > 0),
  other_matters              text,
  -- reg. 312: why this version was issued — the review that led to it.
  revision_reason            text,
  issued_by                  uuid references auth.users (id),
  issued_at                  timestamptz not null default now()
);
create unique index whs_management_plans_version_idx on public.whs_management_plans (project_id, version);

create table public.excavation_records (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects (id) on delete restrict,
  location               text not null check (length(btrim(location)) > 0),
  planned_start_on       date,
  -- reg. 304: the services information, and where it came from.
  info_source            text not null default 'Before You Dig Australia',
  info_reference         text not null check (length(btrim(info_reference)) > 0),
  info_obtained_on       date not null,
  info_valid_until       date,
  services_identified    text,
  plans_file_path        text,
  services_located_by    text,
  locating_method        text,
  located_on             date,
  -- reg. 306: trenches at least 1.5 m deep.
  max_depth_m            numeric(5,2) check (max_depth_m is null or max_depth_m >= 0),
  trench_control         text check (trench_control is null or trench_control in ('benching', 'battering', 'shoring', 'engineer_advice')),
  engineer_advice_ref    text,
  notes                  text,
  recorded_by            uuid references auth.users (id),
  created_at             timestamptz not null default now(),
  constraint excavation_trench_controlled check (
    max_depth_m is null or max_depth_m < 1.5 or trench_control is not null),
  constraint excavation_engineer_in_writing check (
    trench_control is distinct from 'engineer_advice' or length(btrim(coalesce(engineer_advice_ref, ''))) > 0),
  constraint excavation_valid_after_obtained check (info_valid_until is null or info_valid_until >= info_obtained_on)
);
create index excavation_records_idx on public.excavation_records (project_id, created_at desc);

create or replace function app.whs_management_plans_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.projects p where p.id = new.project_id and p.is_principal_contractor) then
    raise exception 'Only the principal contractor holds the WHS management plan. Mark this job as one you are principal contractor on first.'
      using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('whs_plan:' || new.project_id::text));
  new.version := coalesce((select max(version) from public.whs_management_plans where project_id = new.project_id), 0) + 1;
  new.issued_by := coalesce((select auth.uid()), new.issued_by);
  new.issued_at := now();
  return new;
end; $$;
create trigger a_whs_management_plans_before_insert before insert on public.whs_management_plans
  for each row execute function app.whs_management_plans_before_insert();
create trigger a_whs_management_plans_no_update before update on public.whs_management_plans
  for each row execute function app.frozen_row();
create trigger a_whs_management_plans_no_delete before delete on public.whs_management_plans
  for each row execute function app.frozen_row();

create or replace function app.excavation_records_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.info_obtained_on > (now() at time zone 'Australia/Perth')::date then
    raise exception 'The services information cannot have been obtained in the future.' using errcode = 'check_violation';
  end if;
  if new.located_on is not null and new.located_on > (now() at time zone 'Australia/Perth')::date then
    raise exception 'The services cannot have been located in the future.' using errcode = 'check_violation';
  end if;
  new.location := btrim(new.location);
  new.info_reference := btrim(new.info_reference);
  new.recorded_by := coalesce((select auth.uid()), new.recorded_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_excavation_records_before_insert before insert on public.excavation_records
  for each row execute function app.excavation_records_before_insert();
create trigger a_excavation_records_no_update before update on public.excavation_records
  for each row execute function app.frozen_row();
create trigger a_excavation_records_no_delete before delete on public.excavation_records
  for each row execute function app.frozen_row();

alter table public.whs_management_plans enable row level security;
alter table public.excavation_records enable row level security;

-- reg. 311: the plan is made known to everyone carrying out construction work, so every member reads it.
create policy whs_management_plans_select on public.whs_management_plans
  for select to authenticated using (app.is_project_member(project_id));
create policy whs_management_plans_insert on public.whs_management_plans
  for insert to authenticated with check (app.can_manage_incidents(project_id));

-- reg. 304(4): services information readily available to workers, so every member reads it.
create policy excavation_records_select on public.excavation_records
  for select to authenticated using (app.is_project_member(project_id));
create policy excavation_records_insert on public.excavation_records
  for insert to authenticated with check (app.can_run_talks(project_id));

grant select, insert on public.whs_management_plans, public.excavation_records to authenticated;
grant all on public.whs_management_plans, public.excavation_records to service_role;

-- The services plans: {project_id}/{excavation_record_id}.{ext}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('services-plans', 'services-plans', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;
create policy "services plans readable by members" on storage.objects
  for select to authenticated
  using (bucket_id = 'services-plans' and app.is_project_member(app.storage_project_id(name)));
create policy "services plans writable by site crew" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'services-plans' and app.can_run_talks(app.storage_project_id(name)));
