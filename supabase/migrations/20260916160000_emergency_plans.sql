-- ============================================================================
-- Emergency plans per workplace, and the drills that test them.
--
-- WHS (General) Regulations 2022 (WA) reg. 43: the person conducting the
-- business must prepare, maintain and implement an emergency plan FOR THE
-- WORKPLACE that provides for (a) emergency procedures — an effective response,
-- evacuation, notifying emergency services at the earliest opportunity, medical
-- treatment and assistance, and communication with whoever coordinates the
-- response; (b) testing of those procedures, including how often; and (c)
-- information, training and instruction to the workers. Subregulation (3)
-- requires regard to this workplace's work, hazards, size, location and
-- workforce — which is why one company procedure does not serve a site.
--
-- ISO 45001 cl. 8.2 adds the part the regulation does not say in terms: test
-- the planned response periodically and keep documented information of it.
-- That is the drill record.
--
-- The plan is a DOCUMENT and is versioned: a version, once issued, is frozen, and
-- a change is a new version, so the plan in force on the day of an emergency can
-- always be shown. The drill is a RECORD: dated, attributed, frozen.
--
-- Who reads what is deliberate. The current plan — the muster point, the
-- nearest hospital, who to call — is readable by EVERY member, labourers
-- included: reg. 43(1)(c) is about the workers knowing it, and in an emergency
-- the labourer is the one who needs the muster point. Drill records are
-- management's evidence and follow the ordinary record read lock.
-- ============================================================================

create table public.emergency_plans (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid not null references public.projects (id) on delete restrict,
  version                   integer not null,
  -- reg. 43(1)(a): where to go, where the help is, who to call.
  muster_point              text not null check (length(btrim(muster_point)) > 0),
  site_address              text,
  nearest_hospital          text,
  emergency_contacts        text,
  first_aiders              text[] not null default '{}',
  first_aid_location        text,
  fire_equipment_location   text,
  evacuation_procedure      text not null check (length(btrim(evacuation_procedure)) > 0),
  notify_procedure          text,
  spill_response            text,
  site_hazards              text,
  -- reg. 43(1)(b): testing "including the frequency of testing".
  test_every_months         integer not null check (test_every_months between 1 and 24),
  -- reg. 43(1)(c): how the crew are told.
  training_note             text,
  issued_by                 uuid references auth.users (id),
  issued_at                 timestamptz not null default now()
);
create unique index emergency_plans_version_idx on public.emergency_plans (project_id, version);

create table public.emergency_drills (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete restrict,
  plan_id         uuid not null references public.emergency_plans (id) on delete restrict,
  held_on         date not null,
  scenario        text not null check (length(btrim(scenario)) > 0),
  participants    integer check (participants is null or participants >= 0),
  -- Minutes from the alarm to everyone accounted for at the muster point, if timed.
  muster_minutes  numeric(5,1) check (muster_minutes is null or muster_minutes >= 0),
  went_well       text,
  to_improve      text,
  conducted_by    uuid references auth.users (id),
  created_at      timestamptz not null default now()
);
create index emergency_drills_idx on public.emergency_drills (project_id, held_on desc);

-- A plan version is numbered by the database, per workplace, under a lock, and frozen.
create or replace function app.emergency_plans_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('emergency_plan:' || new.project_id::text));
  new.version := coalesce((select max(version) from public.emergency_plans where project_id = new.project_id), 0) + 1;
  new.issued_by := coalesce((select auth.uid()), new.issued_by);
  new.issued_at := now();
  new.muster_point := btrim(new.muster_point);
  new.first_aiders := array(select btrim(x) from unnest(coalesce(new.first_aiders, '{}')) x where length(btrim(x)) > 0);
  return new;
end; $$;
create trigger a_emergency_plans_before_insert before insert on public.emergency_plans
  for each row execute function app.emergency_plans_before_insert();
create trigger a_emergency_plans_no_update before update on public.emergency_plans
  for each row execute function app.frozen_row();
create trigger a_emergency_plans_no_delete before delete on public.emergency_plans
  for each row execute function app.frozen_row();

-- A drill tests a plan of its own workplace, is never in the future, and is frozen.
create or replace function app.emergency_drills_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.emergency_plans p where p.id = new.plan_id and p.project_id = new.project_id) then
    raise exception 'That plan is not this workplace''s.' using errcode = 'check_violation';
  end if;
  if new.held_on > (now() at time zone 'Australia/Perth')::date then
    raise exception 'A drill cannot be recorded before it is held.' using errcode = 'check_violation';
  end if;
  new.conducted_by := coalesce((select auth.uid()), new.conducted_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_emergency_drills_before_insert before insert on public.emergency_drills
  for each row execute function app.emergency_drills_before_insert();
create trigger a_emergency_drills_no_update before update on public.emergency_drills
  for each row execute function app.frozen_row();
create trigger a_emergency_drills_no_delete before delete on public.emergency_drills
  for each row execute function app.frozen_row();

alter table public.emergency_plans enable row level security;
alter table public.emergency_drills enable row level security;

-- The plan: every member of the workplace reads it. Supervisors and admins issue it.
create policy emergency_plans_select_member on public.emergency_plans
  for select to authenticated using (app.is_project_member(project_id));
create policy emergency_plans_insert_managers on public.emergency_plans
  for insert to authenticated with check (app.can_manage_incidents(project_id));

-- Drills: whoever runs talks on site records one; the record read lock applies.
create policy emergency_drills_select on public.emergency_drills
  for select to authenticated using (app.is_project_member(project_id) and app.reads_record(project_id));
create policy emergency_drills_insert_crew on public.emergency_drills
  for insert to authenticated with check (app.can_run_talks(project_id));

grant select, insert on public.emergency_plans, public.emergency_drills to authenticated;
grant all on public.emergency_plans, public.emergency_drills to service_role;
