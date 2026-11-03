-- ============================================================================
-- The asset register (README R186) — item 5 of the Stems migration.
--
-- Stems keeps one asset register for everything the company owns or hires:
-- plant, fire extinguishers, first-aid kits, electrical leads and tools,
-- lifting gear, harnesses, laptops. The IMS had a register for plant alone,
-- and plant is the one kind that already carries its own law (reg. 213's
-- inspection cascade, s. 42 registration, the prestart) — so the plant
-- register STAYS what it is and no row moves. Every machine on it gains an
-- asset row that points at it; everything else gets an asset row of its own.
--
-- What an asset carries, whatever its kind:
--   * asset_profiles       — what falls due on it and how often: a 3-monthly
--                            test and tag, a 6-monthly extinguisher service, a
--                            250-hour service. The next due counts from when
--                            the last one was DONE (R61, R181), or from the
--                            meter. Nothing stores a next due.
--   * asset_records        — the inspection, test or repair itself, for an
--                            asset that is not a machine; frozen once recorded.
--                            A machine's records stay on plant_maintenance_records
--                            (reg. 237) and gain a profile link, so one record
--                            discharges one profile on either table.
--   * asset_meter_readings — hours or kilometres read by hand; a machine's
--                            prestarts and service records are readings too.
--   * asset_checkouts      — who has it and since when; one open custody per
--                            asset; returned = frozen.
--   * asset_actions        — the action a profile RAISES when it falls due,
--                            written by the nightly sweep, one per profile and
--                            due day, closed by the record that discharges it
--                            or by the person it is on. Origin `asset` in the
--                            action register (R177).
-- The register itself is the view asset_register: one shape over both tables,
-- security invoker, so each table's own policy decides what a caller reads.
--
-- Access follows plant: keeping the register, its profiles, records, meters
-- and custody is app.can_manage_plant (supervisor, leading hand, PM, admin,
-- anywhere in the company); reads are the company's record readers — the
-- labourer reads none of it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Assets.
-- ---------------------------------------------------------------------------
create table public.assets (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations (id) on delete restrict,
  -- Set = this asset IS a machine on the plant register; its name, number, make, ownership and supplier live there.
  plant_id      uuid unique references public.plant_register (id) on delete restrict,
  asset_class   text not null check (asset_class in ('plant', 'fire', 'first_aid', 'electrical', 'lifting', 'ppe', 'tool', 'office', 'other')),
  name          text,
  asset_no      text,
  barcode       text,
  category      text,
  make_model    text,
  serial_no     text,
  ownership     text not null default 'own' check (ownership in ('own', 'hired', 'third_party')),
  supplier      text,
  hire_ref      text,
  -- Where it is kept when nobody has it checked out.
  location      text,
  purchased_on  date,
  notes         text,
  active        boolean not null default true,
  retired_reason text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint assets_named_or_plant check ((plant_id is null) = (name is not null)),
  constraint assets_plant_is_plant check (plant_id is null or asset_class = 'plant'),
  constraint assets_class_is_not_plant check (plant_id is not null or asset_class <> 'plant')
);
create index assets_org_idx on public.assets (org_id, active, asset_class);
create unique index assets_barcode_idx on public.assets (org_id, barcode) where barcode is not null;
create unique index assets_no_idx on public.assets (org_id, lower(asset_no)) where asset_no is not null;
create unique index assets_name_idx on public.assets (org_id, lower(name), coalesce(lower(asset_no), '')) where plant_id is null;

comment on table public.assets is 'README R186. Everything the company owns or hires. A machine is an asset whose plant_id names its plant_register row; its machine facts stay there.';

create or replace function app.asset_org(p_asset uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select org_id from public.assets where id = p_asset $$;
grant execute on function app.asset_org(uuid) to authenticated;

create or replace function app.assets_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare porg uuid;
begin
  new.updated_at := now();
  new.name := nullif(btrim(coalesce(new.name, '')), '');
  new.asset_no := nullif(btrim(coalesce(new.asset_no, '')), '');
  new.barcode := nullif(btrim(coalesce(new.barcode, '')), '');
  new.category := nullif(btrim(coalesce(new.category, '')), '');
  new.make_model := nullif(btrim(coalesce(new.make_model, '')), '');
  new.serial_no := nullif(btrim(coalesce(new.serial_no, '')), '');
  new.supplier := nullif(btrim(coalesce(new.supplier, '')), '');
  new.hire_ref := nullif(btrim(coalesce(new.hire_ref, '')), '');
  new.location := nullif(btrim(coalesce(new.location, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.retired_reason := nullif(btrim(coalesce(new.retired_reason, '')), '');
  if new.plant_id is not null then
    select org_id into porg from public.plant_register where id = new.plant_id;
    if porg is null or porg <> new.org_id then
      raise exception 'That machine is another company''s.' using errcode = 'check_violation';
    end if;
    -- A machine's name, number, make, ownership and supplier are the plant register's; one place, not two.
    if new.name is not null or new.asset_no is not null or new.make_model is not null or new.ownership <> 'own' or new.supplier is not null or new.hire_ref is not null then
      raise exception 'A machine''s name, number, make, ownership and supplier are kept on the plant register.' using errcode = 'check_violation';
    end if;
    if not new.active then
      raise exception 'A machine is retired on the plant register, not here.' using errcode = 'check_violation';
    end if;
  end if;
  if not new.active and new.retired_reason is null then
    raise exception 'Say why the asset is retired.' using errcode = 'check_violation';
  end if;
  if new.active then new.retired_reason := null; end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    return new;
  end if;
  if new.org_id <> old.org_id or new.plant_id is distinct from old.plant_id or new.created_at <> old.created_at then
    raise exception 'An asset keeps its company and its machine.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger a_assets_before_write before insert or update on public.assets
  for each row execute function app.assets_before_write();

create or replace function app.assets_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'An asset is retired, never deleted — its records point at it.' using errcode = 'check_violation';
end; $$;
create trigger a_assets_before_delete before delete on public.assets
  for each row execute function app.assets_before_delete();

-- Every machine is an asset: the plant row's insert makes the asset row, and the machines already on the register
-- get theirs now. No plant row moves or changes.
create or replace function app.plant_joins_assets()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.assets (org_id, plant_id, asset_class, created_by)
  values (new.org_id, new.id, 'plant', new.created_by)
  on conflict (plant_id) do nothing;
  return new;
end; $$;
create trigger z_plant_joins_assets after insert on public.plant_register
  for each row execute function app.plant_joins_assets();

insert into public.assets (org_id, plant_id, asset_class, created_by, created_at)
select p.org_id, p.id, 'plant', p.created_by, p.created_at from public.plant_register p
on conflict (plant_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Profiles: what falls due on an asset and how often.
-- ---------------------------------------------------------------------------
create table public.asset_profiles (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations (id) on delete restrict,
  asset_id      uuid not null references public.assets (id) on delete restrict,
  kind          text not null check (kind in ('inspection', 'test', 'maintenance')),
  label         text not null check (length(btrim(label)) > 0),
  -- The clause, the manufacturer's schedule, or the supplier's word.
  basis         text,
  -- By the calendar: every N days, weeks or months from first_due_on …
  every         integer check (every is null or every between 1 and 365),
  unit          text check (unit is null or unit in ('day', 'week', 'month')),
  first_due_on  date,
  -- … or by the meter: every N hours (or km) from the reading the cycle counts from.
  every_hours   numeric(10,1) check (every_hours is null or every_hours > 0),
  start_hours   numeric(12,1) check (start_hours is null or start_hours >= 0),
  -- The action it raises: who it goes to, at what priority.
  assigned_to   uuid references auth.users (id),
  priority      text not null default 'normal' check (priority in ('normal', 'high', 'critical')),
  active        boolean not null default true,
  notes         text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint asset_profiles_calendar_whole check ((every is null) = (unit is null) and (every is null) = (first_due_on is null)),
  constraint asset_profiles_meter_whole check ((every_hours is null) = (start_hours is null)),
  constraint asset_profiles_one_clock check (every is not null or every_hours is not null)
);
create index asset_profiles_asset_idx on public.asset_profiles (asset_id, active);
create index asset_profiles_org_idx on public.asset_profiles (org_id, active);

create or replace function app.asset_profiles_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.label := btrim(new.label);
  new.basis := nullif(btrim(coalesce(new.basis, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  if app.asset_org(new.asset_id) is distinct from new.org_id then
    raise exception 'That asset is another company''s.' using errcode = 'check_violation';
  end if;
  if new.assigned_to is not null and not app.action_assignee_ok(new.org_id, null, new.assigned_to) then
    raise exception 'The profile is assigned to someone in the company.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    return new;
  end if;
  if new.org_id <> old.org_id or new.asset_id <> old.asset_id or new.created_at <> old.created_at then
    raise exception 'A profile keeps its asset.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger a_asset_profiles_before_write before insert or update on public.asset_profiles
  for each row execute function app.asset_profiles_before_write();

create or replace function app.asset_profiles_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'A profile is retired, never deleted — the records and actions it raised point at it.' using errcode = 'check_violation';
end; $$;
create trigger a_asset_profiles_before_delete before delete on public.asset_profiles
  for each row execute function app.asset_profiles_before_delete();

-- ---------------------------------------------------------------------------
-- 3. Records — the inspection, test or repair itself — for an asset that is not a machine.
--    A machine's go on plant_maintenance_records (reg. 237), which gains the profile link.
-- ---------------------------------------------------------------------------
create table public.asset_records (
  id                 uuid primary key default gen_random_uuid(),
  asset_id           uuid not null references public.assets (id) on delete restrict,
  profile_id         uuid references public.asset_profiles (id) on delete restrict,
  kind               text not null check (kind in ('inspection', 'test', 'maintenance', 'repair', 'commissioning', 'decommissioning', 'other')),
  done_on            date not null,
  -- The competent person, and the basis of their competence (reg. 213's wording; it is what an auditor asks to see).
  performed_by_name  text not null check (length(btrim(performed_by_name)) > 0),
  competence         text,
  organisation       text,
  meter_reading      numeric(12,1) check (meter_reading is null or meter_reading >= 0),
  outcome            text check (outcome is null or outcome in ('pass', 'pass_with_actions', 'fail')),
  findings           text,
  -- A date the inspector or the tag sets; it wins over the profile's interval.
  next_due_on        date,
  -- The certificate or report, in bucket plant-records at {org}/{asset}/{record}.ext.
  file_path          text,
  created_by         uuid references auth.users (id),
  created_at         timestamptz not null default now(),
  constraint asset_records_next_after check (next_due_on is null or next_due_on > done_on)
);
create index asset_records_asset_idx on public.asset_records (asset_id, done_on desc);
create index asset_records_profile_idx on public.asset_records (profile_id, done_on desc);

alter table public.plant_maintenance_records add column profile_id uuid references public.asset_profiles (id) on delete restrict;
create index plant_maintenance_records_profile_idx on public.plant_maintenance_records (profile_id, done_on desc);

-- The record discharges the action its profile raised, on either table: open, due on or before the doing.
-- A doing done early still discharges the action for its due day: everything open on the profile that falls due on or
-- before the day the doing itself moves the next due to (or the doing's own day, for a meter profile) is closed. Called
-- AFTER the record is in, so the next due already counts from it.
create or replace function app.asset_record_discharges(p_profile uuid, p_done_on date, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_until date;
begin
  if p_profile is null then return; end if;
  v_until := greatest(p_done_on, coalesce(app.asset_profile_next_due(p_profile), p_done_on));
  update public.asset_actions
     set done_at = now(), done_by = coalesce(auth.uid(), done_by),
         done_note = 'Discharged by the ' || p_kind || ' recorded on ' || to_char(p_done_on, 'DD/MM/YYYY')
   where profile_id = p_profile and done_at is null and due_on <= v_until;
end; $$;

create or replace function app.asset_records_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select org_id, plant_id into a from public.assets where id = new.asset_id;
  if a.org_id is null then
    raise exception 'That asset is not on the register.' using errcode = 'check_violation';
  end if;
  if a.plant_id is not null then
    raise exception 'A machine''s inspections and maintenance are recorded on the machine''s page (reg. 237).' using errcode = 'check_violation';
  end if;
  if new.profile_id is not null and not exists (select 1 from public.asset_profiles p where p.id = new.profile_id and p.asset_id = new.asset_id) then
    raise exception 'That profile belongs to another asset.' using errcode = 'check_violation';
  end if;
  if new.done_on > (now() at time zone 'Australia/Perth')::date then
    raise exception 'It cannot have been done in the future.' using errcode = 'check_violation';
  end if;
  if new.file_path is not null and (split_part(new.file_path, '/', 1) <> a.org_id::text or split_part(new.file_path, '/', 2) <> new.asset_id::text) then
    raise exception 'The file must sit in this asset''s own folder.' using errcode = 'check_violation';
  end if;
  new.performed_by_name := btrim(new.performed_by_name);
  new.competence := nullif(btrim(coalesce(new.competence, '')), '');
  new.organisation := nullif(btrim(coalesce(new.organisation, '')), '');
  new.findings := nullif(btrim(coalesce(new.findings, '')), '');
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_asset_records_before_insert before insert on public.asset_records
  for each row execute function app.asset_records_before_insert();
create trigger a_asset_records_no_update before update on public.asset_records
  for each row execute function app.frozen_row();
create trigger a_asset_records_no_delete before delete on public.asset_records
  for each row execute function app.frozen_row();

create or replace function app.asset_records_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.asset_record_discharges(new.profile_id, new.done_on, new.kind);
  return new;
end; $$;
create trigger z_asset_records_after_insert after insert on public.asset_records
  for each row execute function app.asset_records_after_insert();

-- The machine's record names a profile of ITS asset, and discharges it the same way.
create or replace function app.plant_maintenance_profile_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.profile_id is not null and not exists (
      select 1 from public.asset_profiles p join public.assets a on a.id = p.asset_id
       where p.id = new.profile_id and a.plant_id = new.plant_id) then
    raise exception 'That profile belongs to another asset.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger b_plant_maintenance_profile_check before insert on public.plant_maintenance_records
  for each row execute function app.plant_maintenance_profile_check();

create or replace function app.plant_maintenance_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.asset_record_discharges(new.profile_id, new.done_on, new.kind);
  return new;
end; $$;
create trigger z_plant_maintenance_after_insert after insert on public.plant_maintenance_records
  for each row execute function app.plant_maintenance_after_insert();

-- ---------------------------------------------------------------------------
-- 4. Meter readings, by hand. A machine's prestart hour meter and its service records are readings too;
--    app.asset_latest_meter reads all three.
-- ---------------------------------------------------------------------------
create table public.asset_meter_readings (
  id              uuid primary key default gen_random_uuid(),
  asset_id        uuid not null references public.assets (id) on delete restrict,
  read_on         date not null,
  reading         numeric(12,1) not null check (reading >= 0),
  unit            text not null default 'hours' check (unit in ('hours', 'km')),
  -- A new meter starts again from a lower number; say so, or a lower reading is refused.
  meter_replaced  boolean not null default false,
  note            text,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now()
);
create index asset_meter_readings_asset_idx on public.asset_meter_readings (asset_id, read_on desc, reading desc);

-- The latest reading an asset has, from any source: a reading by hand, a plant prestart's hour meter, a service
-- record's. The latest DAY wins; on the same day, the higher number.
create or replace function app.asset_latest_meter(p_asset uuid)
returns table (reading numeric, read_on date, source text)
language sql stable security definer set search_path = '' as $$
  with all_readings as (
    select r.reading, r.read_on, 'reading'::text as source from public.asset_meter_readings r where r.asset_id = p_asset
    union all
    select s.hour_meter, s.prestart_date, 'prestart' from public.plant_prestarts s join public.assets a on a.plant_id = s.plant_id
     where a.id = p_asset and s.hour_meter is not null and s.completed_at is not null
    union all
    select m.hour_meter, m.done_on, 'service' from public.plant_maintenance_records m join public.assets a on a.plant_id = m.plant_id
     where a.id = p_asset and m.hour_meter is not null
    union all
    select x.meter_reading, x.done_on, 'service' from public.asset_records x where x.asset_id = p_asset and x.meter_reading is not null
  )
  select reading, read_on, source from all_readings order by read_on desc, reading desc limit 1;
$$;
grant execute on function app.asset_latest_meter(uuid) to authenticated;

create or replace function app.asset_meter_readings_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare last record;
begin
  if not exists (select 1 from public.assets where id = new.asset_id) then
    raise exception 'That asset is not on the register.' using errcode = 'check_violation';
  end if;
  if new.read_on > (now() at time zone 'Australia/Perth')::date then
    raise exception 'A reading cannot be in the future.' using errcode = 'check_violation';
  end if;
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  select * into last from app.asset_latest_meter(new.asset_id);
  if last.reading is not null and last.read_on <= new.read_on and new.reading < last.reading and not new.meter_replaced then
    raise exception 'The meter read % on %; a lower reading means a new meter — say so.', last.reading, to_char(last.read_on, 'DD/MM/YYYY') using errcode = 'check_violation';
  end if;
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_asset_meter_readings_before_insert before insert on public.asset_meter_readings
  for each row execute function app.asset_meter_readings_before_insert();
create trigger a_asset_meter_readings_no_update before update on public.asset_meter_readings
  for each row execute function app.frozen_row();
create trigger a_asset_meter_readings_no_delete before delete on public.asset_meter_readings
  for each row execute function app.frozen_row();

-- ---------------------------------------------------------------------------
-- 5. Custody: checked out to a person, on a job or not; checked back in. One open custody per asset.
-- ---------------------------------------------------------------------------
create table public.asset_checkouts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations (id) on delete restrict,
  asset_id       uuid not null references public.assets (id) on delete restrict,
  -- The job it went to, if a job; null for the yard, the office, a ute.
  project_id     uuid references public.projects (id) on delete restrict,
  -- The name on the sheets of who has it.
  holder_name    text not null check (length(btrim(holder_name)) > 0),
  purpose        text,
  due_back_on    date,
  out_at         timestamptz not null default now(),
  out_by         uuid references auth.users (id),
  condition_out  text,
  in_at          timestamptz,
  in_by          uuid references auth.users (id),
  condition_in   text,
  created_at     timestamptz not null default now()
);
create unique index asset_checkouts_one_open on public.asset_checkouts (asset_id) where in_at is null;
create index asset_checkouts_asset_idx on public.asset_checkouts (asset_id, out_at desc);
create index asset_checkouts_project_idx on public.asset_checkouts (project_id) where in_at is null;

create or replace function app.asset_checkouts_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare porg uuid;
begin
  new.holder_name := btrim(new.holder_name);
  new.purpose := nullif(btrim(coalesce(new.purpose, '')), '');
  new.condition_out := nullif(btrim(coalesce(new.condition_out, '')), '');
  new.condition_in := nullif(btrim(coalesce(new.condition_in, '')), '');
  if app.asset_org(new.asset_id) is distinct from new.org_id then
    raise exception 'That asset is another company''s.' using errcode = 'check_violation';
  end if;
  if new.project_id is not null then
    select org_id into porg from public.projects where id = new.project_id;
    if porg is distinct from new.org_id then
      raise exception 'That job is another company''s.' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.assets a where a.id = new.asset_id and (a.active and (a.plant_id is null or exists (select 1 from public.plant_register p where p.id = a.plant_id and p.active)))) then
      raise exception 'A retired asset is not checked out.' using errcode = 'check_violation';
    end if;
    new.out_at := now(); new.out_by := coalesce(auth.uid(), new.out_by);
    new.in_at := null; new.in_by := null; new.condition_in := null;
    new.created_at := now();
    return new;
  end if;
  if old.in_at is not null then
    raise exception 'A returned asset''s custody record is frozen.' using errcode = 'check_violation';
  end if;
  if new.org_id <> old.org_id or new.asset_id <> old.asset_id or new.project_id is distinct from old.project_id or new.holder_name <> old.holder_name
     or new.out_at <> old.out_at or new.out_by is distinct from old.out_by or new.condition_out is distinct from old.condition_out or new.created_at <> old.created_at then
    raise exception 'Who took it, when and where is fixed; check it in or leave it.' using errcode = 'check_violation';
  end if;
  if new.in_at is not null then
    new.in_at := now(); new.in_by := coalesce(auth.uid(), new.in_by);
  else
    new.in_by := null; new.condition_in := null;
  end if;
  return new;
end; $$;
create trigger a_asset_checkouts_before_write before insert or update on public.asset_checkouts
  for each row execute function app.asset_checkouts_before_write();
create trigger a_asset_checkouts_no_delete before delete on public.asset_checkouts
  for each row execute function app.frozen_row();

-- ---------------------------------------------------------------------------
-- 6. The actions a profile raises. Written by the nightly sweep (service role) through
--    public.raise_asset_actions; one per profile and due day; closed by the record that discharges it or by
--    the person it is on; frozen once done; never deleted.
-- ---------------------------------------------------------------------------
create table public.asset_actions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations (id) on delete restrict,
  asset_id     uuid not null references public.assets (id) on delete restrict,
  profile_id   uuid not null references public.asset_profiles (id) on delete restrict,
  due_on       date not null,
  action       text not null check (length(btrim(action)) > 0),
  detail       text,
  priority     text not null default 'normal' check (priority in ('normal', 'high', 'critical')),
  owner_name   text,
  assigned_to  uuid references auth.users (id),
  assigned_at  timestamptz,
  done_at      timestamptz,
  done_by      uuid references auth.users (id),
  done_note    text,
  created_at   timestamptz not null default now(),
  constraint asset_actions_once unique (profile_id, due_on)
);
create index asset_actions_open_idx on public.asset_actions (org_id, done_at, due_on);
create index asset_actions_assigned_idx on public.asset_actions (assigned_to) where done_at is null;

create or replace function app.asset_actions_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.action := btrim(new.action);
  new.detail := nullif(btrim(coalesce(new.detail, '')), '');
  new.owner_name := nullif(btrim(coalesce(new.owner_name, '')), '');
  new.done_note := nullif(btrim(coalesce(new.done_note, '')), '');
  if not app.action_assignee_ok(new.org_id, null, new.assigned_to) then
    raise exception 'An action is assigned to someone in the company.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    if auth.role() = 'authenticated' then
      raise exception 'An asset action is raised by its profile, not by hand — raise a manual action instead.' using errcode = 'check_violation';
    end if;
    new.created_at := now();
    new.assigned_at := case when new.assigned_to is null then null else now() end;
    new.done_at := null; new.done_by := null; new.done_note := null;
    return new;
  end if;
  if old.done_at is not null then
    raise exception 'A done action is frozen.' using errcode = 'check_violation';
  end if;
  if new.org_id <> old.org_id or new.asset_id <> old.asset_id or new.profile_id <> old.profile_id or new.due_on <> old.due_on
     or new.action <> old.action or new.created_at <> old.created_at then
    raise exception 'An asset action keeps its wording and its due date; retire the profile to stop it.' using errcode = 'check_violation';
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is null then null else now() end;
  else
    new.assigned_at := old.assigned_at;
  end if;
  if new.done_at is not null then
    new.done_at := now();
    new.done_by := coalesce(auth.uid(), new.done_by);
  else
    new.done_by := null; new.done_note := null;
  end if;
  return new;
end; $$;
create trigger a_asset_actions_before_write before insert or update on public.asset_actions
  for each row execute function app.asset_actions_before_write();
create trigger a_asset_actions_no_delete before delete on public.asset_actions
  for each row execute function app.frozen_row();

-- The next due of a calendar profile: the first due until one is done, then an interval from the last doing, on
-- either records table; a date the inspector set on the last record wins. Null for a retired or meter-only profile.
-- The SQL twin of `nextDue` in src/lib/assets/model.ts — change both together.
create or replace function app.asset_profile_next_due(p_profile uuid)
returns date language sql stable security definer set search_path = '' as $$
  select case
    when not p.active or p.every is null then null
    when d.done is null then p.first_due_on
    when d.set_due is not null then d.set_due
    when p.unit = 'day' then d.done + p.every
    when p.unit = 'week' then d.done + p.every * 7
    else (d.done + make_interval(months => p.every))::date
  end
  from public.asset_profiles p
  left join lateral (
    select done_on as done, next_due_on as set_due from (
      select r.done_on, r.next_due_on from public.asset_records r where r.profile_id = p.id
      union all
      select m.done_on, m.next_due_on from public.plant_maintenance_records m where m.profile_id = p.id
    ) x order by done_on desc limit 1
  ) d on true
  where p.id = p_profile;
$$;
grant execute on function app.asset_profile_next_due(uuid) to authenticated;

-- The meter reading a meter profile is next due at: the cycle's start, then the last doing's reading, plus the
-- interval. Null for a retired or calendar-only profile.
create or replace function app.asset_profile_due_at_hours(p_profile uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when not p.active or p.every_hours is null then null else coalesce(d.meter, p.start_hours) + p.every_hours end
  from public.asset_profiles p
  left join lateral (
    select meter from (
      select r.done_on, r.meter_reading as meter from public.asset_records r where r.profile_id = p.id and r.meter_reading is not null
      union all
      select m.done_on, m.hour_meter from public.plant_maintenance_records m where m.profile_id = p.id and m.hour_meter is not null
    ) x order by done_on desc limit 1
  ) d on true
  where p.id = p_profile;
$$;
grant execute on function app.asset_profile_due_at_hours(uuid) to authenticated;

-- Raise what is due. For every active profile on an in-service asset: a calendar profile whose next due is within
-- p_within days or past gets an action for that due day; a meter profile whose latest reading has reached the due
-- reading gets one dated the day of that reading. One per profile and due day, however often this runs.
-- Service role only: the sweep's.
create or replace function public.raise_asset_actions(p_today date, p_within integer default 7)
returns integer language plpgsql security definer set search_path = '' as $$
declare p record; v_due date; v_at numeric; m record; n integer := 0; v_name text; v_label text;
begin
  if auth.role() = 'authenticated' then
    raise exception 'The nightly sweep raises asset actions.' using errcode = 'insufficient_privilege';
  end if;
  for p in
    select pr.*, coalesce(pl.name, a.name) as asset_name, coalesce(pl.plant_no, a.asset_no) as asset_no
      from public.asset_profiles pr
      join public.assets a on a.id = pr.asset_id
      left join public.plant_register pl on pl.id = a.plant_id
     where pr.active and a.active and (a.plant_id is null or pl.active)
  loop
    v_name := p.asset_name || case when p.asset_no is not null then ' (' || p.asset_no || ')' else '' end;
    v_label := p.label || ' — ' || v_name;
    v_due := app.asset_profile_next_due(p.id);
    if v_due is not null and v_due <= p_today + p_within then
      insert into public.asset_actions (org_id, asset_id, profile_id, due_on, action, detail, priority, assigned_to)
      values (p.org_id, p.asset_id, p.id, v_due, v_label, p.basis, p.priority, p.assigned_to)
      on conflict (profile_id, due_on) do nothing;
      if found then n := n + 1; end if;
    end if;
    v_at := app.asset_profile_due_at_hours(p.id);
    if v_at is not null then
      select * into m from app.asset_latest_meter(p.asset_id);
      if m.reading is not null and m.reading >= v_at then
        insert into public.asset_actions (org_id, asset_id, profile_id, due_on, action, detail, priority, assigned_to)
        values (p.org_id, p.asset_id, p.id, m.read_on, v_label || ' — due at ' || v_at || ' h, read ' || m.reading || ' h', p.basis, p.priority, p.assigned_to)
        on conflict (profile_id, due_on) do nothing;
        if found then n := n + 1; end if;
      end if;
    end if;
  end loop;
  return n;
end; $$;
revoke execute on function public.raise_asset_actions(date, integer) from public, authenticated;
grant execute on function public.raise_asset_actions(date, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 7. The register: one shape over a machine and anything else.
-- ---------------------------------------------------------------------------
create or replace view public.asset_register
with (security_invoker = true) as
  select a.id, a.org_id, a.plant_id, a.asset_class,
         coalesce(p.name, a.name) as name,
         coalesce(p.plant_no, a.asset_no) as asset_no,
         a.barcode,
         coalesce(a.category, case when p.id is not null then p.kind end) as category,
         coalesce(p.make_model, a.make_model) as make_model,
         a.serial_no,
         case when p.id is null then a.ownership when p.ownership = 'own' then 'own' else 'hired' end as ownership,
         coalesce(p.supplier, a.supplier) as supplier,
         a.hire_ref, a.location, a.purchased_on, a.notes,
         case when p.id is null then a.active else p.active end as active,
         a.retired_reason, a.created_at, a.updated_at
    from public.assets a
    left join public.plant_register p on p.id = a.plant_id;
grant select on public.asset_register to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The action register gains origin `asset` (R177): the view, and the two dispatchers. An asset action keeps
--    its wording and date (the profile's); who holds it, its priority and the name on it may move.
-- ---------------------------------------------------------------------------
create or replace view public.action_register
with (security_invoker = true) as
  select 'manual'::text as origin, a.id, a.org_id, a.project_id,
         null::uuid as record_id, null::text as record_ref, null::text as record_title,
         a.action, a.detail, a.priority, a.owner_name, a.assigned_to, a.due_on,
         a.done_at, a.done_by, a.done_note, a.raised_by, a.created_at as raised_at
    from public.actions a
  union all
  select 'incident', x.id, p.org_id, i.project_id,
         i.id, 'INC-' || lpad(i.seq::text, 3, '0'), left(i.description, 80),
         x.action, null, x.priority, x.owner_name, x.assigned_to, x.due_on,
         x.done_at, x.done_by, x.done_note, x.created_by, x.created_at
    from public.incident_actions x
    join public.incidents i on i.id = x.incident_id
    join public.projects p on p.id = i.project_id
  union all
  select 'inspection', x.id, p.org_id, i.project_id,
         i.id, i.template_name || ' ' || to_char(i.inspection_date, 'DD/MM/YYYY'), null,
         x.action, null, x.priority, x.owner_name, x.assigned_to, x.due_on,
         x.done_at, x.done_by, x.done_note, x.created_by, x.created_at
    from public.inspection_actions x
    join public.inspections i on i.id = x.inspection_id
    join public.projects p on p.id = i.project_id
  union all
  select 'audit', f.id, a.org_id, a.project_id,
         a.id, 'Audit ' || to_char(a.audit_date, 'DD/MM/YYYY'), left(f.finding, 80),
         f.action, null, f.priority, f.owner_name, f.assigned_to, f.due_on,
         f.done_at, null, f.done_note, a.created_by, f.created_at
    from public.audit_findings f
    join public.audits a on a.id = f.audit_id
   where a.status = 'issued' and f.action is not null and length(btrim(f.action)) > 0
  union all
  select 'review', r.id, m.org_id, m.project_id,
         m.id, 'Management review ' || to_char(m.held_on, 'DD/MM/YYYY'), null,
         r.action, null, r.priority, r.owner_name, r.assigned_to, r.due_on,
         r.done_at, null, r.done_note, m.created_by, r.created_at
    from public.review_actions r
    join public.management_reviews m on m.id = r.review_id
   where m.status = 'issued'
  union all
  select 'compliance', c.id, e.org_id, e.project_id,
         e.id, 'Compliance evaluation ' || to_char(e.evaluated_on, 'DD/MM/YYYY'), left(o.title, 80),
         c.action, null, c.priority, c.owner_name, c.assigned_to, c.due_on,
         c.done_at, null, c.done_note, e.created_by, c.created_at
    from public.compliance_evaluation_results c
    join public.compliance_evaluations e on e.id = c.evaluation_id
    join public.env_legal_obligations o on o.id = c.legal_obligation_id
   where e.status = 'issued' and c.result = 'non_compliant' and c.action is not null
  union all
  select 'form', n.id, p.org_id, n.project_id,
         s.id, s.template_code || ' ' || to_char(s.completed_at at time zone 'Australia/Perth', 'DD/MM/YYYY'), left(s.template_title, 80),
         n.action, n.note, n.priority, n.owner_name, n.assigned_to, n.due_on,
         n.done_at, n.done_by, n.done_note, s.completed_by, n.created_at
    from public.form_non_compliances n
    join public.form_submissions s on s.id = n.submission_id
    join public.projects p on p.id = n.project_id
   where n.raised_as_action and n.status <> 'removed' and s.status = 'completed'
  union all
  select 'asset', x.id, x.org_id, null::uuid,
         x.asset_id, coalesce(pl.name, a.name) || case when coalesce(pl.plant_no, a.asset_no) is not null then ' · ' || coalesce(pl.plant_no, a.asset_no) else '' end, left(pr.label, 80),
         x.action, x.detail, x.priority, x.owner_name, x.assigned_to, x.due_on,
         x.done_at, x.done_by, x.done_note, pr.created_by, x.created_at
    from public.asset_actions x
    join public.assets a on a.id = x.asset_id
    left join public.plant_register pl on pl.id = a.plant_id
    join public.asset_profiles pr on pr.id = x.profile_id;

create or replace function public.update_action(
  p_origin text, p_id uuid, p_assigned_to uuid, p_priority text, p_due_on date, p_owner_name text)
returns void language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if p_priority not in ('normal', 'high', 'critical') then
    raise exception 'Priority is normal, high or critical.' using errcode = 'check_violation';
  end if;
  if p_origin = 'manual' then
    update public.actions set assigned_to = p_assigned_to, priority = p_priority, due_on = p_due_on, owner_name = p_owner_name where id = p_id;
  elsif p_origin = 'incident' then
    update public.incident_actions set assigned_to = p_assigned_to, priority = p_priority, due_on = p_due_on, owner_name = p_owner_name where id = p_id;
  elsif p_origin = 'inspection' then
    update public.inspection_actions set assigned_to = p_assigned_to, priority = p_priority, due_on = p_due_on, owner_name = p_owner_name where id = p_id;
  elsif p_origin = 'form' then
    update public.form_non_compliances set assigned_to = p_assigned_to, priority = p_priority, due_on = p_due_on, owner_name = p_owner_name where id = p_id;
  elsif p_origin = 'asset' then
    update public.asset_actions set assigned_to = p_assigned_to, priority = p_priority, owner_name = p_owner_name where id = p_id;
  elsif p_origin = 'audit' then
    update public.audit_findings set assigned_to = p_assigned_to, priority = p_priority where id = p_id;
  elsif p_origin = 'review' then
    update public.review_actions set assigned_to = p_assigned_to, priority = p_priority where id = p_id;
  elsif p_origin = 'compliance' then
    update public.compliance_evaluation_results set assigned_to = p_assigned_to, priority = p_priority where id = p_id;
  else
    raise exception 'Unknown origin.' using errcode = 'check_violation';
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'That action is not on the file, or not yours to change.' using errcode = 'no_data_found'; end if;
end; $$;

create or replace function public.complete_action(p_origin text, p_id uuid, p_note text)
returns void language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if p_origin = 'manual' then
    update public.actions set done_at = now(), done_note = p_note where id = p_id;
  elsif p_origin = 'incident' then
    update public.incident_actions set done_at = now(), done_note = p_note where id = p_id;
  elsif p_origin = 'inspection' then
    update public.inspection_actions set done_at = now(), done_note = p_note where id = p_id;
  elsif p_origin = 'form' then
    update public.form_non_compliances set done_at = now(), done_note = p_note where id = p_id;
  elsif p_origin = 'asset' then
    update public.asset_actions set done_at = now(), done_note = p_note where id = p_id;
  elsif p_origin = 'audit' then
    update public.audit_findings set done_at = now(), done_note = p_note where id = p_id;
  elsif p_origin = 'review' then
    update public.review_actions set done_at = now(), done_note = p_note where id = p_id;
  elsif p_origin = 'compliance' then
    update public.compliance_evaluation_results set done_at = now(), done_note = p_note where id = p_id;
  else
    raise exception 'Unknown origin.' using errcode = 'check_violation';
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'That action is not on the file, or not yours to close.' using errcode = 'no_data_found'; end if;
end; $$;

-- ---------------------------------------------------------------------------
-- 9. Access. Keeping = app.can_manage_plant (supervisor, leading hand, PM, admin anywhere in the company), as the
--    plant register has it. Reads = the company's record readers, restrictive, so the labourer reads none of it by
--    API either. The assignee of an asset action may close it (the point of assigning it).
-- ---------------------------------------------------------------------------
alter table public.assets enable row level security;
alter table public.asset_profiles enable row level security;
alter table public.asset_records enable row level security;
alter table public.asset_meter_readings enable row level security;
alter table public.asset_checkouts enable row level security;
alter table public.asset_actions enable row level security;

create policy assets_select on public.assets for select to authenticated using (app.is_org_member(org_id));
create policy assets_reads_record on public.assets as restrictive for select to authenticated using (app.reads_org_record(org_id));
create policy assets_insert on public.assets for insert to authenticated with check (app.can_manage_plant(org_id));
create policy assets_update on public.assets for update to authenticated using (app.can_manage_plant(org_id)) with check (app.can_manage_plant(org_id));

create policy asset_profiles_select on public.asset_profiles for select to authenticated using (app.is_org_member(org_id));
create policy asset_profiles_reads_record on public.asset_profiles as restrictive for select to authenticated using (app.reads_org_record(org_id));
create policy asset_profiles_insert on public.asset_profiles for insert to authenticated with check (app.can_manage_plant(org_id));
create policy asset_profiles_update on public.asset_profiles for update to authenticated using (app.can_manage_plant(org_id)) with check (app.can_manage_plant(org_id));

create policy asset_records_select on public.asset_records for select to authenticated using (app.is_org_member(app.asset_org(asset_id)));
create policy asset_records_reads_record on public.asset_records as restrictive for select to authenticated using (app.reads_org_record(app.asset_org(asset_id)));
create policy asset_records_insert on public.asset_records for insert to authenticated with check (app.can_manage_plant(app.asset_org(asset_id)));

create policy asset_meter_readings_select on public.asset_meter_readings for select to authenticated using (app.is_org_member(app.asset_org(asset_id)));
create policy asset_meter_readings_reads_record on public.asset_meter_readings as restrictive for select to authenticated using (app.reads_org_record(app.asset_org(asset_id)));
create policy asset_meter_readings_insert on public.asset_meter_readings for insert to authenticated with check (app.can_manage_plant(app.asset_org(asset_id)));

create policy asset_checkouts_select on public.asset_checkouts for select to authenticated using (app.is_org_member(org_id));
create policy asset_checkouts_reads_record on public.asset_checkouts as restrictive for select to authenticated using (app.reads_org_record(org_id));
create policy asset_checkouts_insert on public.asset_checkouts for insert to authenticated with check (app.can_manage_plant(org_id));
create policy asset_checkouts_update on public.asset_checkouts for update to authenticated using (app.can_manage_plant(org_id)) with check (app.can_manage_plant(org_id));

create policy asset_actions_select on public.asset_actions for select to authenticated using (app.is_org_member(org_id));
create policy asset_actions_reads_record on public.asset_actions as restrictive for select to authenticated using (app.reads_org_record(org_id));
create policy asset_actions_update on public.asset_actions for update to authenticated
  using (done_at is null and (assigned_to = (select auth.uid()) or app.can_manage_plant(org_id)))
  with check (assigned_to = (select auth.uid()) or app.can_manage_plant(org_id));

grant select, insert, update on public.assets, public.asset_profiles, public.asset_checkouts, public.asset_actions to authenticated;
grant select, insert on public.asset_records, public.asset_meter_readings to authenticated;
grant all on public.assets, public.asset_profiles, public.asset_records, public.asset_meter_readings, public.asset_checkouts, public.asset_actions to service_role;
