-- ============================================================================
-- Environmental management: what ISO 14001 and the WA contract and law ask a
-- civil job to keep, beyond what the app already held (README R73).
--
-- The research (ISO 14001 on Site, 17/09/2026) found the app already retains
-- most of the evidence ISO 14001 wants — audits and reviews, competence,
-- calibration, emergency plans and drills — and holds nothing for the
-- documents it wants MAINTAINED:
--   * cl. 6.1.2 environmental aspects and their impacts, the criteria for
--     significance, and the significant aspects;
--   * cl. 6.1.3 compliance obligations and how each applies (a legal register),
--     and cl. 9.1.2 the evaluation of compliance, its results retained;
--   * cl. 9.1.1 monitoring results.
-- And the concrete clocks come from contract and law, not ISO:
--   * Main Roads WA Spec 204 cl. 204.28: environmental incident reported within
--     24 hours (moderate, major, catastrophic) or 3 days (insignificant, minor)
--     of becoming known; a Serious incident investigated and reported within
--     28 days of notification. Set PER CONTRACT, never hard-coded — the
--     ncr_report_hours precedent (README R66).
--   * EP Act 1986 (WA) s. 72: written notice to DWER, as soon as practicable, of
--     a discharge causing or likely to cause pollution or environmental harm that
--     came from an emergency, accident or malfunction, breaches an approval, or
--     involves prescribed waste. A phone call alone does not meet it.
-- Refuted in the research, and so NOT built: that ISO prescribes a register
-- format linking each activity to impact and control, and that ISO requires
-- daily dust-control evidence.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Contract clocks and the rain prompt, per job. Null = the contract sets none.
-- ---------------------------------------------------------------------------
alter table public.projects
  add column env_report_hours_serious integer check (env_report_hours_serious is null or env_report_hours_serious between 1 and 720),
  add column env_report_hours_minor integer check (env_report_hours_minor is null or env_report_hours_minor between 1 and 720),
  add column env_investigation_days integer check (env_investigation_days is null or env_investigation_days between 1 and 120),
  -- A prompt, never the record (project_weather_days is a glance, README invariants): rain at
  -- or above this in the Bureau's 24 hours from 9 am asks for an environmental check. The 10 mm
  -- is one NSW plan's trigger (M12 West CEMP); a contract or approval may set another.
  add column env_rain_inspection_mm numeric(5,1) default 10 check (env_rain_inspection_mm is null or env_rain_inspection_mm > 0);

-- ---------------------------------------------------------------------------
-- A history of every change to a maintained register row: the row as it was.
-- ---------------------------------------------------------------------------
create table public.env_register_history (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations (id) on delete restrict,
  table_name  text not null check (table_name in ('env_aspects', 'env_legal_obligations')),
  row_id      uuid not null,
  was         jsonb not null,
  changed_by  uuid references auth.users (id),
  changed_at  timestamptz not null default now()
);
create index env_register_history_row_idx on public.env_register_history (row_id, changed_at);

-- ---------------------------------------------------------------------------
-- cl. 6.1.2: significance criteria, versioned and frozen once set.
-- ---------------------------------------------------------------------------
create table public.env_significance_criteria (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations (id) on delete restrict,
  version     integer not null,
  -- How likelihood and consequence are judged, in words people will apply.
  method      text not null check (length(btrim(method)) > 0),
  -- Likelihood x consequence, each 1 to 5; at or above this an aspect is significant.
  threshold   integer not null check (threshold between 1 and 25),
  issued_by   uuid references auth.users (id),
  issued_at   timestamptz not null default now(),
  unique (org_id, version)
);

create or replace function app.env_criteria_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('env_criteria:' || new.org_id::text));
  new.version := coalesce((select max(version) from public.env_significance_criteria where org_id = new.org_id), 0) + 1;
  new.issued_by := coalesce((select auth.uid()), new.issued_by);
  new.issued_at := now();
  new.method := btrim(new.method);
  return new;
end; $$;
create trigger a_env_criteria_before_insert before insert on public.env_significance_criteria
  for each row execute function app.env_criteria_before_insert();
create trigger a_env_criteria_no_update before update on public.env_significance_criteria
  for each row execute function app.frozen_row();
create trigger a_env_criteria_no_delete before delete on public.env_significance_criteria
  for each row execute function app.frozen_row();

-- ---------------------------------------------------------------------------
-- cl. 6.1.2: aspects and impacts, company-wide, with the jobs they apply to.
-- ---------------------------------------------------------------------------
create table public.env_aspects (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations (id) on delete restrict,
  activity      text not null check (length(btrim(activity)) > 0),
  aspect        text not null check (length(btrim(aspect)) > 0),
  impact        text not null check (length(btrim(impact)) > 0),
  condition     text not null default 'normal' check (condition in ('normal', 'abnormal', 'emergency')),
  likelihood    integer not null check (likelihood between 1 and 5),
  consequence   integer not null check (consequence between 1 and 5),
  score         integer generated always as (likelihood * consequence) stored,
  -- Stamped by the database against the criteria in force when it was last assessed.
  criteria_id   uuid references public.env_significance_criteria (id) on delete restrict,
  significant   boolean not null default false,
  controls      text,
  active        boolean not null default true,
  reviewed_by   uuid references auth.users (id),
  reviewed_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index env_aspects_org_idx on public.env_aspects (org_id, active, significant);

create or replace function app.env_aspects_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  if tg_op = 'UPDATE' then
    if new.org_id is distinct from old.org_id or new.created_at is distinct from old.created_at then
      raise exception 'An aspect stays with its company.' using errcode = 'check_violation';
    end if;
    insert into public.env_register_history (org_id, table_name, row_id, was, changed_by)
    values (old.org_id, 'env_aspects', old.id, to_jsonb(old), (select auth.uid()));
  else
    new.created_at := now();
  end if;
  select id, threshold into c from public.env_significance_criteria
   where org_id = new.org_id order by version desc limit 1;
  if c.id is null then
    raise exception 'Set the significance criteria first — an aspect is judged against them (ISO 14001 cl. 6.1.2).' using errcode = 'check_violation';
  end if;
  new.criteria_id := c.id;
  new.significant := (new.likelihood * new.consequence) >= c.threshold;
  new.activity := btrim(new.activity); new.aspect := btrim(new.aspect); new.impact := btrim(new.impact);
  new.controls := nullif(btrim(coalesce(new.controls, '')), '');
  new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
  new.reviewed_at := now();
  return new;
end; $$;
create trigger a_env_aspects_before_write before insert or update on public.env_aspects
  for each row execute function app.env_aspects_before_write();
create trigger a_env_aspects_no_delete before delete on public.env_aspects
  for each row execute function app.frozen_row();

create table public.project_env_aspects (
  project_id  uuid not null references public.projects (id) on delete restrict,
  aspect_id   uuid not null references public.env_aspects (id) on delete restrict,
  applies     boolean not null default true,
  note        text,
  set_by      uuid references auth.users (id),
  set_at      timestamptz not null default now(),
  primary key (project_id, aspect_id)
);

create or replace function app.project_env_aspects_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.env_aspects a join public.projects p on p.org_id = a.org_id
                  where a.id = new.aspect_id and p.id = new.project_id) then
    raise exception 'That aspect is not this company''s.' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.project_id is distinct from old.project_id or new.aspect_id is distinct from old.aspect_id) then
    raise exception 'Say whether it applies; do not move it.' using errcode = 'check_violation';
  end if;
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.set_by := coalesce((select auth.uid()), new.set_by);
  new.set_at := now();
  return new;
end; $$;
create trigger a_project_env_aspects_before_write before insert or update on public.project_env_aspects
  for each row execute function app.project_env_aspects_before_write();
create trigger a_project_env_aspects_no_delete before delete on public.project_env_aspects
  for each row execute function app.frozen_row();

-- ---------------------------------------------------------------------------
-- cl. 6.1.3: the legal register. Company-wide, or one job's (a contract, an approval).
-- ---------------------------------------------------------------------------
create table public.env_legal_obligations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations (id) on delete restrict,
  project_id    uuid references public.projects (id) on delete restrict,
  title         text not null check (length(btrim(title)) > 0),
  source_type   text not null check (source_type in ('legislation', 'regulation', 'approval', 'licence', 'contract', 'standard', 'other')),
  reference     text not null check (length(btrim(reference)) > 0),
  requirement   text not null check (length(btrim(requirement)) > 0),
  -- How it applies to what this company or job does: the part auditors ask for.
  how_applies   text not null check (length(btrim(how_applies)) > 0),
  active        boolean not null default true,
  reviewed_by   uuid references auth.users (id),
  reviewed_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index env_legal_obligations_idx on public.env_legal_obligations (org_id, project_id, active);

create table public.env_obligation_aspects (
  obligation_id  uuid not null references public.env_legal_obligations (id) on delete restrict,
  aspect_id      uuid not null references public.env_aspects (id) on delete restrict,
  primary key (obligation_id, aspect_id)
);

create or replace function app.env_legal_obligations_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.project_id is not null and not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'That job is not in this organisation.' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    if new.org_id is distinct from old.org_id or new.project_id is distinct from old.project_id or new.created_at is distinct from old.created_at then
      raise exception 'An obligation stays where it was recorded.' using errcode = 'check_violation';
    end if;
    insert into public.env_register_history (org_id, table_name, row_id, was, changed_by)
    values (old.org_id, 'env_legal_obligations', old.id, to_jsonb(old), (select auth.uid()));
  else
    new.created_at := now();
  end if;
  new.title := btrim(new.title); new.reference := btrim(new.reference);
  new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
  new.reviewed_at := now();
  return new;
end; $$;
create trigger a_env_legal_obligations_before_write before insert or update on public.env_legal_obligations
  for each row execute function app.env_legal_obligations_before_write();
create trigger a_env_legal_obligations_no_delete before delete on public.env_legal_obligations
  for each row execute function app.frozen_row();

create or replace function app.env_obligation_aspects_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and not exists (
    select 1 from public.env_legal_obligations o join public.env_aspects a on a.org_id = o.org_id
     where o.id = new.obligation_id and a.id = new.aspect_id) then
    raise exception 'That aspect is not this company''s.' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end; $$;
create trigger a_env_obligation_aspects_check before insert on public.env_obligation_aspects
  for each row execute function app.env_obligation_aspects_check();

-- ---------------------------------------------------------------------------
-- cl. 9.1.2: evaluations of compliance, discharging their schedule when issued.
-- ---------------------------------------------------------------------------
create table public.compliance_evaluations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organisations (id) on delete restrict,
  project_id      uuid references public.projects (id) on delete restrict,
  obligation_id   uuid references public.obligations (id) on delete restrict,
  evaluated_on    date not null,
  evaluator_name  text not null check (length(btrim(evaluator_name)) > 0),
  summary         text,
  status          text not null default 'draft' check (status in ('draft', 'issued')),
  issued_on       date,
  issued_by       uuid references auth.users (id),
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now()
);
create index compliance_evaluations_idx on public.compliance_evaluations (org_id, project_id, evaluated_on desc);

create table public.compliance_evaluation_results (
  id                   uuid primary key default gen_random_uuid(),
  evaluation_id        uuid not null references public.compliance_evaluations (id) on delete cascade,
  legal_obligation_id  uuid not null references public.env_legal_obligations (id) on delete restrict,
  result               text not null check (result in ('compliant', 'non_compliant', 'not_applicable')),
  evidence             text,
  action               text,
  owner_name           text,
  due_on               date,
  done_at              timestamptz,
  done_note            text,
  created_at           timestamptz not null default now(),
  unique (evaluation_id, legal_obligation_id),
  constraint compliance_result_evidence check (result = 'not_applicable' or length(btrim(coalesce(evidence, ''))) > 0),
  constraint compliance_result_action check (result <> 'non_compliant' or length(btrim(coalesce(action, ''))) > 0)
);

-- The obligations an evaluation must cover: every active company-wide one, and, for a
-- job's evaluation, that job's own; for a company evaluation, every job's too.
create or replace function app.compliance_scope_missing(p_evaluation uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer
    from public.compliance_evaluations e
    join public.env_legal_obligations o on o.org_id = e.org_id and o.active
     and (e.project_id is null or o.project_id is null or o.project_id = e.project_id)
   where e.id = p_evaluation
     and not exists (select 1 from public.compliance_evaluation_results r
                      where r.evaluation_id = e.id and r.legal_obligation_id = o.id)
$$;
grant execute on function app.compliance_scope_missing(uuid) to authenticated;

create or replace function app.compliance_evaluations_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare due date; missing integer;
begin
  if tg_op = 'INSERT' then
    perform app.check_scope_and_schedule(new.org_id, new.project_id, new.obligation_id, 'compliance_evaluation');
    new.status := 'draft'; new.issued_on := null; new.issued_by := null;
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
    if new.evaluated_on > app.perth_today() then
      raise exception 'An evaluation is recorded once it is done.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.status = 'issued' then
    raise exception 'An issued evaluation of compliance is frozen.' using errcode = 'check_violation';
  end if;
  if new.org_id is distinct from old.org_id or new.project_id is distinct from old.project_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'An evaluation stays with its job.' using errcode = 'check_violation';
  end if;
  if new.obligation_id is distinct from old.obligation_id then
    perform app.check_scope_and_schedule(new.org_id, new.project_id, new.obligation_id, 'compliance_evaluation');
  end if;
  if new.evaluated_on > app.perth_today() then
    raise exception 'An evaluation is recorded once it is done.' using errcode = 'check_violation';
  end if;
  if new.status = 'issued' then
    missing := app.compliance_scope_missing(new.id);
    if missing > 0 then
      raise exception 'Every obligation in the register needs a result before the evaluation is issued — % without one.', missing using errcode = 'check_violation';
    end if;
    if length(btrim(coalesce(new.summary, ''))) = 0 then
      raise exception 'An evaluation needs its summary of compliance status (ISO 14001 cl. 9.1.2).' using errcode = 'check_violation';
    end if;
    new.issued_on := app.perth_today();
    new.issued_by := coalesce((select auth.uid()), new.issued_by);
    if new.obligation_id is not null then
      due := app.obligation_next_due(new.obligation_id);
      if due is not null then
        insert into public.obligation_completions (obligation_id, due_on, done_on, evidence_note, evidence_ref)
        values (new.obligation_id, due, new.evaluated_on,
                'Evaluation of compliance issued. Evaluator: ' || new.evaluator_name || '.',
                'compliance:' || new.id::text);
      end if;
    end if;
  end if;
  return new;
end; $$;
create trigger a_compliance_evaluations_before_write before insert or update on public.compliance_evaluations
  for each row execute function app.compliance_evaluations_before_write();
create trigger a_compliance_evaluations_no_delete before delete on public.compliance_evaluations
  for each row execute function app.frozen_row();

create or replace function app.compliance_results_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare st text; eval record;
begin
  select status, org_id, project_id into eval from public.compliance_evaluations where id = coalesce(new.evaluation_id, old.evaluation_id);
  st := eval.status;
  if tg_op = 'DELETE' then
    if st is null then return old; end if;
    if st <> 'draft' then raise exception 'A result in an issued evaluation is never removed.' using errcode = 'check_violation'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if st <> 'draft' then raise exception 'Results are recorded while the evaluation is a draft.' using errcode = 'check_violation'; end if;
    if not exists (select 1 from public.env_legal_obligations o where o.id = new.legal_obligation_id and o.org_id = eval.org_id
                    and (eval.project_id is null or o.project_id is null or o.project_id = eval.project_id)) then
      raise exception 'That obligation is not in this evaluation''s register.' using errcode = 'check_violation';
    end if;
    new.done_at := null; new.created_at := now();
    return new;
  end if;
  if st = 'draft' then
    if new.evaluation_id is distinct from old.evaluation_id or new.legal_obligation_id is distinct from old.legal_obligation_id then
      raise exception 'A result stays with its obligation.' using errcode = 'check_violation';
    end if;
    if new.done_at is not null and old.done_at is null then new.done_at := now(); end if;
    return new;
  end if;
  if old.done_at is not null then raise exception 'A done action is frozen.' using errcode = 'check_violation'; end if;
  if new.result is distinct from old.result or new.evidence is distinct from old.evidence or new.action is distinct from old.action
     or new.owner_name is distinct from old.owner_name or new.due_on is distinct from old.due_on
     or new.evaluation_id is distinct from old.evaluation_id or new.legal_obligation_id is distinct from old.legal_obligation_id then
    raise exception 'A result in an issued evaluation does not change; only its action is marked done.' using errcode = 'check_violation';
  end if;
  if new.done_at is not null then new.done_at := now(); end if;
  return new;
end; $$;
create trigger a_compliance_results_before_write before insert or update or delete on public.compliance_evaluation_results
  for each row execute function app.compliance_results_before_write();

-- ---------------------------------------------------------------------------
-- Environmental incidents: Spec 204 assessment and clocks, DWER s. 72 notice.
-- ---------------------------------------------------------------------------
create table public.incident_environment_events (
  id            uuid primary key default gen_random_uuid(),
  incident_id   uuid not null references public.incidents (id) on delete restrict,
  kind          text not null check (kind in (
                  'assessed',                 -- Spec 204 severity, and whether Serious (Spec 203)
                  'superintendent_notified',  -- cl. 204.28: as soon as practicable
                  'report_given',             -- cl. 204.28: within the contract's hours
                  'investigation_given',      -- Serious: within the contract's days of notification
                  'dwer_notifiable',          -- s. 72 applies, and why
                  'dwer_phoned',              -- Environment WAtch 1300 784 782 — not notice on its own
                  'dwer_written_notice'       -- s. 72 written notice given
                )),
  happened_at   timestamptz not null,
  severity      text check (severity is null or severity in ('insignificant', 'minor', 'moderate', 'major', 'catastrophic')),
  serious       boolean,
  dwer_trigger  text check (dwer_trigger is null or dwer_trigger in ('emergency_accident_malfunction', 'breach_of_approval', 'prescribed_waste')),
  person_name   text,
  detail        text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  constraint env_event_assessed check (kind <> 'assessed' or (severity is not null and serious is not null)),
  constraint env_event_dwer_trigger check (kind <> 'dwer_notifiable' or dwer_trigger is not null)
);
create index incident_environment_events_idx on public.incident_environment_events (incident_id, happened_at);

create or replace function app.incident_environment_events_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.incidents i where i.id = new.incident_id and i.kind = 'environmental') then
    raise exception 'Only an environmental incident carries this trail.' using errcode = 'check_violation';
  end if;
  if new.happened_at > now() + interval '10 minutes' then
    raise exception 'That time is in the future.' using errcode = 'check_violation';
  end if;
  if new.kind <> 'assessed' then new.severity := null; new.serious := null; end if;
  if new.kind <> 'dwer_notifiable' then new.dwer_trigger := null; end if;
  new.person_name := nullif(btrim(coalesce(new.person_name, '')), '');
  new.detail := nullif(btrim(coalesce(new.detail, '')), '');
  new.created_by := coalesce((select auth.uid()), new.created_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_incident_environment_events_before_insert before insert on public.incident_environment_events
  for each row execute function app.incident_environment_events_before_insert();
create trigger a_incident_environment_events_no_update before update on public.incident_environment_events
  for each row execute function app.frozen_row();
create trigger a_incident_environment_events_no_delete before delete on public.incident_environment_events
  for each row execute function app.frozen_row();

-- ---------------------------------------------------------------------------
-- cl. 9.1.1: monitoring results — dust, noise, vibration, water, waste.
-- ---------------------------------------------------------------------------
create table public.env_monitoring_records (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete restrict,
  monitored_on   date not null,
  kind           text not null check (kind in ('dust', 'noise', 'vibration', 'water', 'waste', 'other')),
  location       text not null check (length(btrim(location)) > 0),
  parameter      text not null check (length(btrim(parameter)) > 0),
  value          numeric,
  unit           text,
  limit_value    numeric,
  equipment_id   uuid references public.measuring_equipment (id) on delete restrict,
  method         text,
  -- Set by the database from value and limit when both are given; otherwise as recorded.
  outcome        text not null check (outcome in ('within_limit', 'exceedance', 'observation')),
  action_taken   text,
  notes          text,
  recorded_by    uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  constraint env_monitoring_value_unit check (value is null or length(btrim(coalesce(unit, ''))) > 0),
  constraint env_monitoring_exceedance_action check (outcome <> 'exceedance' or length(btrim(coalesce(action_taken, ''))) > 0)
);
create index env_monitoring_records_idx on public.env_monitoring_records (project_id, monitored_on desc);

create or replace function app.env_monitoring_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.monitored_on > app.perth_today() then
    raise exception 'Monitoring is recorded once it is done.' using errcode = 'check_violation';
  end if;
  if new.value is not null and new.limit_value is not null then
    new.outcome := case when new.value > new.limit_value then 'exceedance' else 'within_limit' end;
    if new.outcome = 'exceedance' and length(btrim(coalesce(new.action_taken, ''))) = 0 then
      raise exception 'That reading is over its limit — record what was done about it.' using errcode = 'check_violation';
    end if;
  end if;
  if new.equipment_id is not null and not exists (
    select 1 from public.measuring_equipment m join public.projects p on p.org_id = m.org_id
     where m.id = new.equipment_id and p.id = new.project_id) then
    raise exception 'That instrument is not this company''s.' using errcode = 'check_violation';
  end if;
  new.recorded_by := coalesce((select auth.uid()), new.recorded_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_env_monitoring_before_insert before insert on public.env_monitoring_records
  for each row execute function app.env_monitoring_before_insert();
create trigger a_env_monitoring_no_update before update on public.env_monitoring_records
  for each row execute function app.frozen_row();
create trigger a_env_monitoring_no_delete before delete on public.env_monitoring_records
  for each row execute function app.frozen_row();

-- ---------------------------------------------------------------------------
-- The schedule: an environmental audit kind for Spec 204 cl. 204.32.
-- ---------------------------------------------------------------------------
-- (Spec 204 audits are internal audits of the EMP's operational controls; the
-- existing 'internal_audit' kind and audits module hold them. Only a preset is
-- added, in src/lib/obligations/model.ts.)

-- ---------------------------------------------------------------------------
-- Access. Registers and evaluations are management information: written by crew
-- managers (supervisors, admins) for the company or supervisors and admins for a job,
-- read by those who read the record. Monitoring is recorded by the crew who run the
-- day. The labourer reads none of it.
-- ---------------------------------------------------------------------------
create or replace function app.compliance_evaluation_scope(p uuid) returns table (org_id uuid, project_id uuid)
language sql stable security definer set search_path = '' as $$ select e.org_id, e.project_id from public.compliance_evaluations e where e.id = p $$;
create or replace function app.env_obligation_org(p uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select org_id from public.env_legal_obligations where id = p $$;
grant execute on function app.compliance_evaluation_scope(uuid), app.env_obligation_org(uuid) to authenticated;

alter table public.env_register_history enable row level security;
alter table public.env_significance_criteria enable row level security;
alter table public.env_aspects enable row level security;
alter table public.project_env_aspects enable row level security;
alter table public.env_legal_obligations enable row level security;
alter table public.env_obligation_aspects enable row level security;
alter table public.compliance_evaluations enable row level security;
alter table public.compliance_evaluation_results enable row level security;
alter table public.incident_environment_events enable row level security;
alter table public.env_monitoring_records enable row level security;

create policy env_history_select on public.env_register_history for select to authenticated
  using (app.is_org_member(org_id) and app.reads_org_record(org_id));

create policy env_criteria_select on public.env_significance_criteria for select to authenticated
  using (app.is_org_member(org_id) and app.reads_org_record(org_id));
create policy env_criteria_insert on public.env_significance_criteria for insert to authenticated
  with check (app.can_manage_crew(org_id));

create policy env_aspects_select on public.env_aspects for select to authenticated
  using (app.is_org_member(org_id) and app.reads_org_record(org_id));
create policy env_aspects_insert on public.env_aspects for insert to authenticated with check (app.can_manage_crew(org_id));
create policy env_aspects_update on public.env_aspects for update to authenticated
  using (app.can_manage_crew(org_id)) with check (app.can_manage_crew(org_id));

create policy project_env_aspects_select on public.project_env_aspects for select to authenticated
  using (app.is_project_member(project_id) and app.reads_record(project_id));
create policy project_env_aspects_insert on public.project_env_aspects for insert to authenticated
  with check (app.can_manage_incidents(project_id));
create policy project_env_aspects_update on public.project_env_aspects for update to authenticated
  using (app.can_manage_incidents(project_id)) with check (app.can_manage_incidents(project_id));

create policy env_legal_select on public.env_legal_obligations for select to authenticated
  using (app.obligation_readable(org_id, project_id));
create policy env_legal_insert on public.env_legal_obligations for insert to authenticated
  with check (app.obligation_manageable(org_id, project_id));
create policy env_legal_update on public.env_legal_obligations for update to authenticated
  using (app.obligation_manageable(org_id, project_id)) with check (app.obligation_manageable(org_id, project_id));

create policy env_obligation_aspects_select on public.env_obligation_aspects for select to authenticated
  using (app.is_org_member(app.env_obligation_org(obligation_id)) and app.reads_org_record(app.env_obligation_org(obligation_id)));
create policy env_obligation_aspects_write on public.env_obligation_aspects for all to authenticated
  using (app.can_manage_crew(app.env_obligation_org(obligation_id)))
  with check (app.can_manage_crew(app.env_obligation_org(obligation_id)));

create policy compliance_evaluations_select on public.compliance_evaluations for select to authenticated
  using (app.obligation_readable(org_id, project_id));
create policy compliance_evaluations_insert on public.compliance_evaluations for insert to authenticated
  with check (app.obligation_manageable(org_id, project_id));
create policy compliance_evaluations_update on public.compliance_evaluations for update to authenticated
  using (app.obligation_manageable(org_id, project_id)) with check (app.obligation_manageable(org_id, project_id));
create policy compliance_results_select on public.compliance_evaluation_results for select to authenticated
  using (exists (select 1 from app.compliance_evaluation_scope(evaluation_id) s where app.obligation_readable(s.org_id, s.project_id)));
create policy compliance_results_write on public.compliance_evaluation_results for all to authenticated
  using (exists (select 1 from app.compliance_evaluation_scope(evaluation_id) s where app.obligation_manageable(s.org_id, s.project_id)))
  with check (exists (select 1 from app.compliance_evaluation_scope(evaluation_id) s where app.obligation_manageable(s.org_id, s.project_id)));

create policy incident_environment_events_select on public.incident_environment_events for select to authenticated
  using (app.is_project_member(app.regulator_event_project(incident_id)) and app.reads_record(app.regulator_event_project(incident_id)));
create policy incident_environment_events_insert on public.incident_environment_events for insert to authenticated
  with check (app.can_manage_incidents(app.regulator_event_project(incident_id)));

create policy env_monitoring_select on public.env_monitoring_records for select to authenticated
  using (app.is_project_member(project_id) and app.reads_record(project_id));
create policy env_monitoring_insert on public.env_monitoring_records for insert to authenticated
  with check (app.can_run_talks(project_id));

grant select on public.env_register_history to authenticated;
grant select, insert on public.env_significance_criteria, public.incident_environment_events, public.env_monitoring_records to authenticated;
grant select, insert, update on public.env_aspects, public.project_env_aspects, public.env_legal_obligations, public.compliance_evaluations to authenticated;
grant select, insert, update, delete on public.env_obligation_aspects, public.compliance_evaluation_results to authenticated;
grant all on public.env_register_history, public.env_significance_criteria, public.env_aspects, public.project_env_aspects,
  public.env_legal_obligations, public.env_obligation_aspects, public.compliance_evaluations, public.compliance_evaluation_results,
  public.incident_environment_events, public.env_monitoring_records to service_role;
