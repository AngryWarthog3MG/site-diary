-- ============================================================================
-- Plant: who inspected it, on what basis, and whether it needs registering.
--
-- WHS (General) Regulations 2022 (WA):
--   reg. 213 — maintenance, inspection and if necessary testing "conducted by a
--     competent person", at intervals that cascade: (a) the manufacturer's
--     recommendations; (b) failing that, a competent person's; (c) for
--     INSPECTION only, failing both, annually. A single frequency field cannot
--     express that, so the basis is stored alongside the interval.
--   reg. 237 — records of tests, inspections, maintenance, commissioning,
--     decommissioning, dismantling and alterations, kept for as long as the
--     plant is used or until control is relinquished.
-- WHS Act 2020 (WA) s. 42 — plant whose design or item must be registered may
--   not be used, and a worker may not be directed to use it, unless it is.
--   Schedule 5 Div 2 lists the items: tower cranes, mobile cranes over 10 t,
--   concrete placing booms, lifts, boilers and pressure vessels at hazard levels
--   A to C, and amusement devices.
--
-- The design caution from the research (README R59, entry 05): a civil and
-- landscaping fleet of excavators, skid steers, rollers, dumpers and trucks
-- contains few or no registrable items. So registration is OFF unless someone
-- says a machine needs it, and the use-block below only ever bites on a machine
-- marked as needing registration. Nothing here nags about a mini excavator.
--
-- And a note the verification added: reg. 213 does not literally require the
-- inspector's competence to be recorded. It is recorded anyway, because "done by
-- a competent person" cannot be shown without naming the person and the basis
-- of their competence, and it is what an auditor asks to see.
-- ============================================================================

alter table public.plant_register
  add column if not exists inspection_basis text
    check (inspection_basis is null or inspection_basis in ('manufacturer', 'competent_person', 'annual')),
  add column if not exists inspection_interval_months integer
    check (inspection_interval_months is null or inspection_interval_months between 1 and 60),
  add column if not exists registration_required boolean not null default false,
  add column if not exists registration_kind text
    check (registration_kind is null or registration_kind in ('item', 'design')),
  add column if not exists registration_no text,
  add column if not exists registration_expires_on date;

comment on column public.plant_register.inspection_basis is
  'reg. 213 cascade: manufacturer''s recommendation, else a competent person''s, else annually (inspection only).';
comment on column public.plant_register.registration_required is
  'WHS Act s. 42 / Sch. 5. Off by default: most civil plant is not registrable. When on, a lapsed or missing registration blocks a plant prestart.';

create table public.plant_maintenance_records (
  id                  uuid primary key default gen_random_uuid(),
  plant_id            uuid not null references public.plant_register (id) on delete restrict,
  kind                text not null check (kind in (
                        'inspection', 'test', 'maintenance', 'commissioning', 'decommissioning', 'dismantling', 'alteration')),
  done_on             date not null,
  -- reg. 213: the competent person, and the basis of their competence.
  performed_by_name   text not null check (length(btrim(performed_by_name)) > 0),
  competence          text,
  organisation        text,
  hour_meter          numeric(10,1) check (hour_meter is null or hour_meter >= 0),
  outcome             text check (outcome is null or outcome in ('pass', 'pass_with_actions', 'fail')),
  findings            text,
  -- The next date the inspector or the manufacturer set, when they set one. It overrides the interval.
  next_due_on         date,
  -- The service report or inspection certificate, if there is a file.
  file_path           text,
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default now(),
  constraint plant_maintenance_next_after check (next_due_on is null or next_due_on > done_on)
);
create index plant_maintenance_records_idx on public.plant_maintenance_records (plant_id, done_on desc);

create or replace function app.plant_org(p_plant uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select org_id from public.plant_register where id = p_plant $$;
grant execute on function app.plant_org(uuid) to authenticated;

create or replace function app.plant_maintenance_records_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.done_on > (now() at time zone 'Australia/Perth')::date then
    raise exception 'It cannot have been done in the future.' using errcode = 'check_violation';
  end if;
  new.performed_by_name := btrim(new.performed_by_name);
  new.competence := nullif(btrim(coalesce(new.competence, '')), '');
  new.organisation := nullif(btrim(coalesce(new.organisation, '')), '');
  new.findings := nullif(btrim(coalesce(new.findings, '')), '');
  new.created_by := coalesce((select auth.uid()), new.created_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_plant_maintenance_records_before_insert before insert on public.plant_maintenance_records
  for each row execute function app.plant_maintenance_records_before_insert();
create trigger a_plant_maintenance_records_no_update before update on public.plant_maintenance_records
  for each row execute function app.frozen_row();
create trigger a_plant_maintenance_records_no_delete before delete on public.plant_maintenance_records
  for each row execute function app.frozen_row();

alter table public.plant_maintenance_records enable row level security;
create policy plant_maintenance_records_select on public.plant_maintenance_records
  for select to authenticated using (
    app.is_org_member(app.plant_org(plant_id)) and app.reads_org_record(app.plant_org(plant_id)));
create policy plant_maintenance_records_insert on public.plant_maintenance_records
  for insert to authenticated with check (app.can_manage_plant(app.plant_org(plant_id)));
grant select, insert on public.plant_maintenance_records to authenticated;
grant all on public.plant_maintenance_records to service_role;

-- s. 42: a machine marked as needing registration, with none recorded or one lapsed, is not prestarted —
-- which is the app's door to using it. Only ever bites on a machine someone marked as registrable.
create or replace function app.plant_prestarts_registration_current()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select name, registration_required, registration_no, registration_expires_on into r
    from public.plant_register where id = new.plant_id;
  if r.registration_required then
    if length(btrim(coalesce(r.registration_no, ''))) = 0 then
      raise exception '% needs registration and none is recorded. It may not be used (WHS Act s. 42).', r.name
        using errcode = 'check_violation';
    end if;
    if r.registration_expires_on is not null and r.registration_expires_on < (now() at time zone 'Australia/Perth')::date then
      raise exception '% has a lapsed registration. It may not be used (WHS Act s. 42).', r.name
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end; $$;
create trigger plant_prestarts_registration_current before insert on public.plant_prestarts
  for each row execute function app.plant_prestarts_registration_current();

-- Service reports and certificates: {org_id}/{plant_id}/{record_id}.{ext}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plant-records', 'plant-records', false, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;
create policy "plant records readable by record readers" on storage.objects
  for select to authenticated
  using (bucket_id = 'plant-records'
         and app.is_org_member(((storage.foldername(name))[1])::uuid)
         and app.reads_org_record(((storage.foldername(name))[1])::uuid));
create policy "plant records writable by plant managers" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'plant-records' and app.can_manage_plant(((storage.foldername(name))[1])::uuid));
