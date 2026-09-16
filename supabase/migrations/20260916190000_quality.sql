-- ============================================================================
-- Quality: inspection and test plans, lots, hold points, non-conformance, and
-- the calibration register.
--
-- What WA principals and councils actually require of a civil contractor
-- (README R59, entries 08–11), drawn from Main Roads WA Specification 201
-- Quality Management (revision register current to 13/10/2025) and the
-- AUS-SPEC-derived council specification C02:
--
--   ITP, cl. 201.06.02 — each ITP includes (a) the work processes and their
--     inspection and test points, (b) who is responsible, (c) frequency, (d)
--     methods, (e) acceptance criteria, (f) which measurements or tests use
--     calibrated equipment, (g) all Witness Points and Hold Points. Made
--     available to the Superintendent for review before issue — review, not
--     approval.
--   Hold Point — "a mandatory verification position ... beyond which work
--     cannot proceed without the designated authorisation" (C02 cl. 1.4.2).
--   Lot registration, cl. 201.07.02 — a unique Lot number, description,
--     location (3D surveyed position where necessary), traceability of all
--     sampling and test results, cross-referenced compliance and
--     non-compliance records, and identification of Lots that replace
--     non-conforming Lots, which are re-numbered and cross-referenced.
--   Non-conformance, cl. 201.10 — every detected non-conformance is a Hold
--     Point on the work it relates to and is reported to the Superintendent
--     within 24 hours; the NCR records observation, attribution, location,
--     root cause, corrective and preventative actions, and the proposed
--     disposition. cl. 201.06.04: no further testing until the NCR is
--     submitted and corrective action approved.
--   ISO 9001 cl. 7.1.5 — measuring equipment calibrated, and the record kept.
--
-- Two cautions from verification, carried into the design:
--   - The 24-hour clock and the automatic hold point are a CONTRACT
--     requirement of Main Roads and principals like it, not something ISO 9001
--     imposes. So the clock is a per-job setting, off unless set.
--   - A stronger claim — that a Lot is capped at one day's output and Lot
--     numbers are the universal primary key — was refuted. Neither is
--     enforced here.
--
-- The shape follows the rest of the record: an ITP is a document, editable
-- as a draft and frozen once issued, revised by a new version that supersedes
-- it on issue (as SWMS are); a check, a release and a calibration are records,
-- stamped and frozen; a lot and an NCR each have a first account that does not
-- change and a lifecycle that only moves forward.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The contractual NCR clock, per job. Null means the job's contract sets none.
-- ---------------------------------------------------------------------------
alter table public.projects add column if not exists ncr_report_hours integer
  check (ncr_report_hours is null or ncr_report_hours between 1 and 720);
comment on column public.projects.ncr_report_hours is
  'Hours within which a detected non-conformance must be reported to the principal, if the contract sets it (Main Roads WA Spec 201 cl. 201.10: 24). Null = no contractual clock.';

-- ---------------------------------------------------------------------------
-- Calibration register (org-wide): measuring equipment and its calibrations.
-- ---------------------------------------------------------------------------
create table public.measuring_equipment (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references public.organisations (id) on delete restrict,
  name                        text not null check (length(btrim(name)) > 0),
  serial_no                   text,
  kind                        text,
  calibration_interval_months integer check (calibration_interval_months is null or calibration_interval_months between 1 and 60),
  active                      boolean not null default true,
  created_by                  uuid references auth.users (id),
  created_at                  timestamptz not null default now()
);
create unique index measuring_equipment_unique_idx on public.measuring_equipment (org_id, lower(btrim(name)), coalesce(lower(btrim(serial_no)), ''));

create table public.equipment_calibrations (
  id              uuid primary key default gen_random_uuid(),
  equipment_id    uuid not null references public.measuring_equipment (id) on delete restrict,
  calibrated_on   date not null,
  due_on          date not null,
  certificate_no  text not null check (length(btrim(certificate_no)) > 0),
  calibrated_by   text,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  constraint equipment_calibrations_due_after check (due_on > calibrated_on)
);
create index equipment_calibrations_idx on public.equipment_calibrations (equipment_id, due_on desc);

-- ---------------------------------------------------------------------------
-- Inspection and test plans.
-- ---------------------------------------------------------------------------
create table public.itps (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid not null references public.projects (id) on delete restrict,
  code                      text not null check (length(btrim(code)) > 0),
  title                     text not null check (length(btrim(title)) > 0),
  spec_reference            text,
  revision                  integer not null,
  status                    text not null default 'draft' check (status in ('draft', 'issued', 'superseded')),
  supersedes_id             uuid references public.itps (id) on delete restrict,
  submitted_to_principal_on date,
  principal_review_note     text,
  created_by                uuid references auth.users (id),
  created_at                timestamptz not null default now(),
  issued_by                 uuid references auth.users (id),
  issued_at                 timestamptz
);
create unique index itps_revision_idx on public.itps (project_id, lower(btrim(code)), revision);

create table public.itp_points (
  id                          uuid primary key default gen_random_uuid(),
  itp_id                      uuid not null references public.itps (id) on delete cascade,
  seq                         integer not null,
  activity                    text not null check (length(btrim(activity)) > 0),
  inspection_test             text not null check (length(btrim(inspection_test)) > 0),
  acceptance_criteria         text not null check (length(btrim(acceptance_criteria)) > 0),
  method                      text,
  frequency                   text not null check (length(btrim(frequency)) > 0),
  responsible                 text not null check (length(btrim(responsible)) > 0),
  reviewer                    text,
  point_type                  text not null check (point_type in ('hold', 'witness', 'surveillance', 'record')),
  uses_calibrated_equipment   boolean not null default false,
  record_required             text
);
create unique index itp_points_seq_idx on public.itp_points (itp_id, seq);

-- ---------------------------------------------------------------------------
-- Lots, the checks against them, and hold point releases.
-- ---------------------------------------------------------------------------
create table public.lots (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete restrict,
  seq                integer not null,
  itp_id             uuid not null references public.itps (id) on delete restrict,
  description        text not null check (length(btrim(description)) > 0),
  location           text not null check (length(btrim(location)) > 0),
  surveyed_position  text,
  status             text not null default 'open' check (status in ('open', 'nonconforming', 'conforming', 'replaced')),
  replaces_lot_id    uuid references public.lots (id) on delete restrict,
  opened_by          uuid references auth.users (id),
  opened_at          timestamptz not null default now(),
  closed_by          uuid references auth.users (id),
  closed_at          timestamptz,
  close_note         text
);
create unique index lots_seq_idx on public.lots (project_id, seq);

create table public.lot_checks (
  id              uuid primary key default gen_random_uuid(),
  lot_id          uuid not null references public.lots (id) on delete restrict,
  itp_point_id    uuid not null references public.itp_points (id) on delete restrict,
  result          text not null check (result in ('conforms', 'does_not_conform', 'na')),
  measured        text,
  test_reference  text,
  equipment_id    uuid references public.measuring_equipment (id) on delete restrict,
  checked_on      date not null,
  notes           text,
  checked_by      uuid references auth.users (id),
  created_at      timestamptz not null default now()
);
create index lot_checks_idx on public.lot_checks (lot_id, itp_point_id, created_at desc);

create table public.hold_point_releases (
  id                uuid primary key default gen_random_uuid(),
  lot_id            uuid not null references public.lots (id) on delete restrict,
  itp_point_id      uuid not null references public.itp_points (id) on delete restrict,
  released_at       timestamptz not null,
  released_by_name  text not null check (length(btrim(released_by_name)) > 0),
  authority         text,
  note              text,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now()
);
create unique index hold_point_releases_one_idx on public.hold_point_releases (lot_id, itp_point_id);

-- ---------------------------------------------------------------------------
-- Non-conformance reports.
-- ---------------------------------------------------------------------------
create table public.ncrs (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid not null references public.projects (id) on delete restrict,
  seq                       integer not null,
  lot_id                    uuid references public.lots (id) on delete restrict,
  itp_point_id              uuid references public.itp_points (id) on delete restrict,
  detected_at               timestamptz not null,
  detected_by_name          text not null check (length(btrim(detected_by_name)) > 0),
  observation               text not null check (length(btrim(observation)) > 0),
  attribution               text,
  location                  text,
  root_cause                text,
  corrective_action         text,
  preventive_action         text,
  disposition               text check (disposition is null or disposition in ('rework', 'repair', 'use_as_is', 'reject')),
  disposition_detail        text,
  reported_to_principal_at  timestamptz,
  principal_response        text,
  status                    text not null default 'open' check (status in ('open', 'approved', 'closed')),
  approved_by_name          text,
  approved_at               timestamptz,
  approved_by               uuid references auth.users (id),
  closed_at                 timestamptz,
  closed_by                 uuid references auth.users (id),
  close_note                text,
  created_by                uuid references auth.users (id),
  created_at                timestamptz not null default now()
);
create unique index ncrs_seq_idx on public.ncrs (project_id, seq);
create index ncrs_lot_idx on public.ncrs (lot_id, status);

-- ===========================================================================
-- Rules.
-- ===========================================================================

create or replace function app.perth_today() returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'Australia/Perth')::date $$;

-- Calibration current on a day: a calibration made on or before it, due on or after it.
create or replace function app.equipment_calibrated_on(p_equipment uuid, p_day date)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.equipment_calibrations c
     where c.equipment_id = p_equipment and c.calibrated_on <= p_day and c.due_on >= p_day)
$$;
grant execute on function app.equipment_calibrated_on(uuid, date) to authenticated;

create or replace function app.equipment_calibrations_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.calibrated_on > app.perth_today() then
    raise exception 'A calibration cannot be dated in the future.' using errcode = 'check_violation';
  end if;
  new.certificate_no := btrim(new.certificate_no);
  new.created_by := coalesce((select auth.uid()), new.created_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_equipment_calibrations_before_insert before insert on public.equipment_calibrations
  for each row execute function app.equipment_calibrations_before_insert();
create trigger a_equipment_calibrations_no_update before update on public.equipment_calibrations
  for each row execute function app.frozen_row();
create trigger a_equipment_calibrations_no_delete before delete on public.equipment_calibrations
  for each row execute function app.frozen_row();

-- ITP: revision numbered per job and code; a revision supersedes one of its own code.
create or replace function app.itps_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare prior record;
begin
  new.code := btrim(new.code);
  if new.supersedes_id is not null then
    select project_id, code, status into prior from public.itps where id = new.supersedes_id;
    if prior is null or prior.project_id <> new.project_id or lower(prior.code) <> lower(new.code) then
      raise exception 'A revision supersedes an ITP of the same code on the same job.' using errcode = 'check_violation';
    end if;
    if prior.status <> 'issued' then
      raise exception 'Only an issued ITP is revised.' using errcode = 'check_violation';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('itp:' || new.project_id::text || ':' || lower(new.code)));
  new.revision := coalesce((select max(revision) from public.itps where project_id = new.project_id and lower(code) = lower(new.code)), 0) + 1;
  new.status := 'draft';
  new.created_by := coalesce((select auth.uid()), new.created_by);
  new.created_at := now();
  new.issued_at := null;
  new.issued_by := null;
  return new;
end; $$;
create trigger a_itps_before_insert before insert on public.itps
  for each row execute function app.itps_before_insert();

-- ITP lifecycle: a draft is edited and issued; an issued ITP only takes its review note or is superseded; then frozen.
create or replace function app.itps_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare missing integer;
begin
  if new.project_id is distinct from old.project_id or lower(new.code) is distinct from lower(old.code)
     or new.revision is distinct from old.revision or new.supersedes_id is distinct from old.supersedes_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'An ITP keeps its job, code and revision.' using errcode = 'check_violation';
  end if;

  if old.status = 'superseded' then
    raise exception 'A superseded ITP is frozen.' using errcode = 'check_violation';
  end if;

  if old.status = 'issued' then
    if new.status = 'superseded' then
      if new.title is distinct from old.title or new.spec_reference is distinct from old.spec_reference then
        raise exception 'An issued ITP does not change; revise it.' using errcode = 'check_violation';
      end if;
      return new;
    end if;
    if new.status <> 'issued' or new.title is distinct from old.title or new.spec_reference is distinct from old.spec_reference
       or new.issued_at is distinct from old.issued_at or new.issued_by is distinct from old.issued_by then
      raise exception 'An issued ITP does not change; revise it.' using errcode = 'check_violation';
    end if;
    return new;  -- only the principal's review date and note may be recorded
  end if;

  -- old.status = 'draft'
  if new.status = 'superseded' then
    raise exception 'A draft is issued or deleted, not superseded.' using errcode = 'check_violation';
  end if;
  if new.status = 'issued' then
    select count(*) into missing from public.itp_points where itp_id = old.id;
    if missing = 0 then
      raise exception 'An ITP needs at least one inspection or test point before it is issued.' using errcode = 'check_violation';
    end if;
    new.issued_at := now();
    new.issued_by := coalesce((select auth.uid()), new.issued_by);
    if old.supersedes_id is not null then
      update public.itps set status = 'superseded' where id = old.supersedes_id and status = 'issued';
    end if;
  end if;
  return new;
end; $$;
create trigger a_itps_before_update before update on public.itps
  for each row execute function app.itps_before_update();

create or replace function app.itps_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'draft' then
    raise exception 'An issued ITP is a record and is never deleted.' using errcode = 'check_violation';
  end if;
  return old;
end; $$;
create trigger a_itps_before_delete before delete on public.itps
  for each row execute function app.itps_before_delete();

-- Points change only while their ITP is a draft.
create or replace function app.itp_points_draft_only()
returns trigger language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  select status into st from public.itps where id = coalesce(new.itp_id, old.itp_id);
  -- A draft being deleted cascades to its points; the ITP row is already gone by then.
  if st is null and tg_op = 'DELETE' then return old; end if;
  if st is distinct from 'draft' then
    raise exception 'The points of an issued ITP do not change; revise the ITP.' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.itp_id is distinct from old.itp_id then
    raise exception 'A point stays on its ITP.' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end; $$;
create trigger a_itp_points_draft_only before insert or update or delete on public.itp_points
  for each row execute function app.itp_points_draft_only();

-- Lots: numbered per job, worked to an issued ITP of the same job; a replacement lot replaces a non-conforming one.
create or replace function app.lots_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare itp record; orig record;
begin
  select project_id, status into itp from public.itps where id = new.itp_id;
  if itp is null or itp.project_id <> new.project_id then
    raise exception 'A lot is worked to an ITP of its own job.' using errcode = 'check_violation';
  end if;
  if itp.status <> 'issued' then
    raise exception 'A lot is worked to an issued ITP, not a draft or a superseded one.' using errcode = 'check_violation';
  end if;
  if new.replaces_lot_id is not null then
    select project_id, status into orig from public.lots where id = new.replaces_lot_id;
    if orig is null or orig.project_id <> new.project_id then
      raise exception 'A replacement lot replaces a lot on the same job.' using errcode = 'check_violation';
    end if;
    if orig.status <> 'nonconforming' then
      raise exception 'Only a non-conforming lot is replaced.' using errcode = 'check_violation';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('lot:' || new.project_id::text));
  new.seq := coalesce((select max(seq) from public.lots where project_id = new.project_id), 0) + 1;
  new.status := 'open';
  new.description := btrim(new.description);
  new.location := btrim(new.location);
  new.opened_by := coalesce((select auth.uid()), new.opened_by);
  new.opened_at := now();
  new.closed_at := null; new.closed_by := null;
  return new;
end; $$;
create trigger a_lots_before_insert before insert on public.lots
  for each row execute function app.lots_before_insert();

create or replace function app.lots_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.replaces_lot_id is not null then
    update public.lots set status = 'replaced' where id = new.replaces_lot_id and status = 'nonconforming';
  end if;
  return null;
end; $$;
create trigger b_lots_after_insert after insert on public.lots
  for each row execute function app.lots_after_insert();

-- The problems standing between a lot and closing it as conforming. Empty = it may close.
create or replace function app.lot_close_problems(p_lot uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  lot record;
  out text[] := '{}';
  pt record;
  latest record;
begin
  select * into lot from public.lots where id = p_lot;
  if lot is null then return array['No such lot.']; end if;
  if exists (select 1 from public.ncrs n where n.lot_id = p_lot and n.status <> 'closed') then
    out := out || 'A non-conformance on this lot is not closed.';
  end if;
  for pt in select * from public.itp_points where itp_id = lot.itp_id order by seq loop
    select c.result into latest from public.lot_checks c
     where c.lot_id = p_lot and c.itp_point_id = pt.id order by c.created_at desc limit 1;
    if latest is null then
      out := out || ('Point ' || pt.seq || ' (' || pt.inspection_test || ') has no result.');
    elsif latest.result = 'does_not_conform' and not exists (
      select 1 from public.ncrs n where n.lot_id = p_lot and n.itp_point_id = pt.id and n.status = 'closed' and n.disposition = 'use_as_is') then
      out := out || ('Point ' || pt.seq || ' (' || pt.inspection_test || ') does not conform.');
    end if;
    if pt.point_type = 'hold' and not exists (select 1 from public.hold_point_releases r where r.lot_id = p_lot and r.itp_point_id = pt.id) then
      out := out || ('Hold point ' || pt.seq || ' (' || pt.inspection_test || ') is not released.');
    end if;
  end loop;
  return out;
end; $$;
grant execute on function app.lot_close_problems(uuid) to authenticated;

create or replace function app.lots_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare problems text[];
begin
  if new.project_id is distinct from old.project_id or new.seq is distinct from old.seq or new.itp_id is distinct from old.itp_id
     or new.description is distinct from old.description or new.location is distinct from old.location
     or new.replaces_lot_id is distinct from old.replaces_lot_id or new.opened_by is distinct from old.opened_by
     or new.opened_at is distinct from old.opened_at then
    raise exception 'A lot''s first account does not change.' using errcode = 'check_violation';
  end if;
  if old.status in ('conforming', 'replaced') then
    raise exception 'A closed lot is frozen.' using errcode = 'check_violation';
  end if;
  if new.status = old.status then
    -- Only the surveyed position may be added while the lot is open.
    if new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by or new.close_note is distinct from old.close_note then
      raise exception 'A lot is closed by moving it to conforming.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.status = 'nonconforming' then
    return new;  -- a failed check or an NCR puts the lot on hold
  end if;
  if new.status = 'replaced' then
    if not exists (select 1 from public.lots l where l.replaces_lot_id = old.id) then
      raise exception 'A lot is replaced by opening a replacement lot.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.status = 'open' then
    raise exception 'A lot on hold is released by closing its non-conformance, not by reopening it.' using errcode = 'check_violation';
  end if;
  -- new.status = 'conforming'
  problems := app.lot_close_problems(old.id);
  if array_length(problems, 1) > 0 then
    raise exception 'This lot cannot close: %', array_to_string(problems, ' ') using errcode = 'check_violation';
  end if;
  new.closed_at := now();
  new.closed_by := coalesce((select auth.uid()), new.closed_by);
  return new;
end; $$;
create trigger a_lots_before_update before update on public.lots
  for each row execute function app.lots_before_update();
create trigger a_lots_no_delete before delete on public.lots
  for each row execute function app.frozen_row();

-- A check: against a point of the lot's own ITP, not in the future, with current calibration where the point needs it.
-- No further testing on a lot on hold until every NCR on it has an approved corrective action (cl. 201.06.04).
create or replace function app.lot_checks_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare lot record; pt record;
begin
  select * into lot from public.lots where id = new.lot_id;
  select * into pt from public.itp_points where id = new.itp_point_id;
  if lot is null or pt is null or pt.itp_id <> lot.itp_id then
    raise exception 'A check is against a point of the lot''s own ITP.' using errcode = 'check_violation';
  end if;
  if lot.status in ('conforming', 'replaced') then
    raise exception 'That lot is closed.' using errcode = 'check_violation';
  end if;
  if lot.status = 'nonconforming' and exists (select 1 from public.ncrs n where n.lot_id = lot.id and n.status = 'open') then
    raise exception 'No further testing on this lot until its non-conformance has an approved corrective action.' using errcode = 'check_violation';
  end if;
  if new.checked_on > app.perth_today() then
    raise exception 'A check cannot be dated in the future.' using errcode = 'check_violation';
  end if;
  if pt.uses_calibrated_equipment then
    if new.equipment_id is null then
      raise exception 'This point uses calibrated equipment: say which.' using errcode = 'check_violation';
    end if;
    if not app.equipment_calibrated_on(new.equipment_id, new.checked_on) then
      raise exception 'That equipment was not in calibration on the day of the check.' using errcode = 'check_violation';
    end if;
  end if;
  new.checked_by := coalesce((select auth.uid()), new.checked_by);
  new.created_at := clock_timestamp();
  return new;
end; $$;
create trigger a_lot_checks_before_insert before insert on public.lot_checks
  for each row execute function app.lot_checks_before_insert();

create or replace function app.lot_checks_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.result = 'does_not_conform' then
    update public.lots set status = 'nonconforming' where id = new.lot_id and status = 'open';
  end if;
  return null;
end; $$;
create trigger b_lot_checks_after_insert after insert on public.lot_checks
  for each row execute function app.lot_checks_after_insert();
create trigger a_lot_checks_no_update before update on public.lot_checks
  for each row execute function app.frozen_row();
create trigger a_lot_checks_no_delete before delete on public.lot_checks
  for each row execute function app.frozen_row();

-- A release: of a HOLD point of the lot's ITP, on an open lot, whose latest check conforms.
create or replace function app.hold_point_releases_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare lot record; pt record; latest text;
begin
  select * into lot from public.lots where id = new.lot_id;
  select * into pt from public.itp_points where id = new.itp_point_id;
  if lot is null or pt is null or pt.itp_id <> lot.itp_id then
    raise exception 'A release is of a point of the lot''s own ITP.' using errcode = 'check_violation';
  end if;
  if pt.point_type <> 'hold' then
    raise exception 'Only a hold point is released.' using errcode = 'check_violation';
  end if;
  if lot.status <> 'open' then
    raise exception 'A hold point is released on an open lot.' using errcode = 'check_violation';
  end if;
  select c.result into latest from public.lot_checks c
   where c.lot_id = new.lot_id and c.itp_point_id = new.itp_point_id order by c.created_at desc limit 1;
  if latest is distinct from 'conforms' then
    raise exception 'A hold point is released once its check conforms.' using errcode = 'check_violation';
  end if;
  if new.released_at > now() + interval '10 minutes' then
    raise exception 'A release cannot be in the future.' using errcode = 'check_violation';
  end if;
  new.released_by_name := btrim(new.released_by_name);
  new.created_by := coalesce((select auth.uid()), new.created_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_hold_point_releases_before_insert before insert on public.hold_point_releases
  for each row execute function app.hold_point_releases_before_insert();
create trigger a_hold_point_releases_no_update before update on public.hold_point_releases
  for each row execute function app.frozen_row();
create trigger a_hold_point_releases_no_delete before delete on public.hold_point_releases
  for each row execute function app.frozen_row();

-- NCR: numbered per job; a non-conformance puts its lot on hold.
create or replace function app.ncrs_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare lot record; pt record;
begin
  if new.lot_id is not null then
    select * into lot from public.lots where id = new.lot_id;
    if lot is null or lot.project_id <> new.project_id then
      raise exception 'An NCR is raised against a lot of its own job.' using errcode = 'check_violation';
    end if;
    if new.itp_point_id is not null then
      select * into pt from public.itp_points where id = new.itp_point_id;
      if pt is null or pt.itp_id <> lot.itp_id then
        raise exception 'The point is not on this lot''s ITP.' using errcode = 'check_violation';
      end if;
    end if;
  elsif new.itp_point_id is not null then
    raise exception 'A point is named together with its lot.' using errcode = 'check_violation';
  end if;
  if new.detected_at > now() + interval '10 minutes' then
    raise exception 'A non-conformance cannot be detected in the future.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('ncr:' || new.project_id::text));
  new.seq := coalesce((select max(seq) from public.ncrs where project_id = new.project_id), 0) + 1;
  new.status := 'open';
  new.approved_at := null; new.approved_by := null; new.approved_by_name := null;
  new.closed_at := null; new.closed_by := null;
  new.created_by := coalesce((select auth.uid()), new.created_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_ncrs_before_insert before insert on public.ncrs
  for each row execute function app.ncrs_before_insert();

create or replace function app.ncrs_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lot_id is not null then
    update public.lots set status = 'nonconforming' where id = new.lot_id and status = 'open';
  end if;
  return null;
end; $$;
create trigger b_ncrs_after_insert after insert on public.ncrs
  for each row execute function app.ncrs_after_insert();

create or replace function app.ncrs_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The first account is frozen.
  if new.project_id is distinct from old.project_id or new.seq is distinct from old.seq or new.lot_id is distinct from old.lot_id
     or new.itp_point_id is distinct from old.itp_point_id or new.detected_at is distinct from old.detected_at
     or new.detected_by_name is distinct from old.detected_by_name or new.observation is distinct from old.observation
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'The non-conformance as detected does not change.' using errcode = 'check_violation';
  end if;
  if old.status = 'closed' then
    raise exception 'A closed NCR is frozen.' using errcode = 'check_violation';
  end if;
  -- Once reported, the report time stands.
  if old.reported_to_principal_at is not null and new.reported_to_principal_at is distinct from old.reported_to_principal_at then
    raise exception 'The time it was reported does not change.' using errcode = 'check_violation';
  end if;
  if old.status = 'approved' then
    if new.root_cause is distinct from old.root_cause or new.corrective_action is distinct from old.corrective_action
       or new.preventive_action is distinct from old.preventive_action or new.disposition is distinct from old.disposition
       or new.disposition_detail is distinct from old.disposition_detail or new.approved_by_name is distinct from old.approved_by_name
       or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by then
      raise exception 'An approved disposition does not change.' using errcode = 'check_violation';
    end if;
    if new.status = 'open' then
      raise exception 'An approved NCR moves on to closed, not back.' using errcode = 'check_violation';
    end if;
  end if;
  if old.status = 'open' and new.status = 'approved' then
    if length(btrim(coalesce(new.root_cause, ''))) = 0 or length(btrim(coalesce(new.corrective_action, ''))) = 0 or new.disposition is null then
      raise exception 'Approval needs the root cause, the corrective action and the disposition.' using errcode = 'check_violation';
    end if;
    if length(btrim(coalesce(new.approved_by_name, ''))) = 0 then
      raise exception 'Name who approved the disposition.' using errcode = 'check_violation';
    end if;
    new.approved_at := now();
    new.approved_by := coalesce((select auth.uid()), new.approved_by);
  end if;
  if old.status = 'open' and new.status = 'closed' then
    raise exception 'A disposition is approved before the NCR is closed.' using errcode = 'check_violation';
  end if;
  if new.status = 'closed' and old.status = 'approved' then
    new.closed_at := now();
    new.closed_by := coalesce((select auth.uid()), new.closed_by);
  end if;
  return new;
end; $$;
create trigger a_ncrs_before_update before update on public.ncrs
  for each row execute function app.ncrs_before_update();
create trigger a_ncrs_no_delete before delete on public.ncrs
  for each row execute function app.frozen_row();

-- ===========================================================================
-- Access.
-- ===========================================================================
create or replace function app.itp_project(p_itp uuid) returns uuid language sql stable security definer set search_path = ''
as $$ select project_id from public.itps where id = p_itp $$;
create or replace function app.lot_project(p_lot uuid) returns uuid language sql stable security definer set search_path = ''
as $$ select project_id from public.lots where id = p_lot $$;
create or replace function app.equipment_org(p_eq uuid) returns uuid language sql stable security definer set search_path = ''
as $$ select org_id from public.measuring_equipment where id = p_eq $$;
grant execute on function app.itp_project(uuid), app.lot_project(uuid), app.equipment_org(uuid) to authenticated;

create or replace function app.reads_quality(p_project uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select app.is_project_member(p_project) and app.reads_record(p_project) $$;
grant execute on function app.reads_quality(uuid) to authenticated;

alter table public.measuring_equipment enable row level security;
alter table public.equipment_calibrations enable row level security;
alter table public.itps enable row level security;
alter table public.itp_points enable row level security;
alter table public.lots enable row level security;
alter table public.lot_checks enable row level security;
alter table public.hold_point_releases enable row level security;
alter table public.ncrs enable row level security;

create policy measuring_equipment_select on public.measuring_equipment for select to authenticated
  using (app.is_org_member(org_id) and app.reads_org_record(org_id));
create policy measuring_equipment_write on public.measuring_equipment for all to authenticated
  using (app.can_manage_crew(org_id)) with check (app.can_manage_crew(org_id));
create policy equipment_calibrations_select on public.equipment_calibrations for select to authenticated
  using (app.is_org_member(app.equipment_org(equipment_id)) and app.reads_org_record(app.equipment_org(equipment_id)));
create policy equipment_calibrations_insert on public.equipment_calibrations for insert to authenticated
  with check (app.can_manage_crew(app.equipment_org(equipment_id)));

-- ITPs are written by supervisors and admins.
create policy itps_select on public.itps for select to authenticated using (app.reads_quality(project_id));
create policy itps_insert on public.itps for insert to authenticated with check (app.can_manage_incidents(project_id));
create policy itps_update on public.itps for update to authenticated using (app.can_manage_incidents(project_id)) with check (app.can_manage_incidents(project_id));
create policy itps_delete on public.itps for delete to authenticated using (app.can_manage_incidents(project_id));
create policy itp_points_select on public.itp_points for select to authenticated using (app.reads_quality(app.itp_project(itp_id)));
create policy itp_points_write on public.itp_points for all to authenticated
  using (app.can_manage_incidents(app.itp_project(itp_id))) with check (app.can_manage_incidents(app.itp_project(itp_id)));

-- Lots are opened, checked and closed by whoever runs the site; hold points released by the same.
create policy lots_select on public.lots for select to authenticated using (app.reads_quality(project_id));
create policy lots_insert on public.lots for insert to authenticated with check (app.can_run_talks(project_id));
create policy lots_update on public.lots for update to authenticated using (app.can_run_talks(project_id)) with check (app.can_run_talks(project_id));
create policy lot_checks_select on public.lot_checks for select to authenticated using (app.reads_quality(app.lot_project(lot_id)));
create policy lot_checks_insert on public.lot_checks for insert to authenticated with check (app.can_run_talks(app.lot_project(lot_id)));
create policy hold_point_releases_select on public.hold_point_releases for select to authenticated using (app.reads_quality(app.lot_project(lot_id)));
create policy hold_point_releases_insert on public.hold_point_releases for insert to authenticated with check (app.can_run_talks(app.lot_project(lot_id)));

-- Anyone running the site raises an NCR; supervisors and admins approve and close it.
create policy ncrs_select on public.ncrs for select to authenticated using (app.reads_quality(project_id));
create policy ncrs_insert on public.ncrs for insert to authenticated with check (app.can_run_talks(project_id));
create policy ncrs_update on public.ncrs for update to authenticated using (app.can_manage_incidents(project_id)) with check (app.can_manage_incidents(project_id));

grant select, insert, update on public.measuring_equipment to authenticated;
grant select, insert on public.equipment_calibrations, public.lot_checks, public.hold_point_releases to authenticated;
grant select, insert, update, delete on public.itps, public.itp_points to authenticated;
grant select, insert, update on public.lots, public.ncrs to authenticated;
grant all on public.measuring_equipment, public.equipment_calibrations, public.itps, public.itp_points, public.lots,
  public.lot_checks, public.hold_point_releases, public.ncrs to service_role;
