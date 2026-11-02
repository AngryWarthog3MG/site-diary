-- ============================================================================
-- Hazard controls (README R179). A hazard report said what was seen; nothing
-- said what was done about it, or how well. Now:
--   * the report carries a hazard type (frozen with the first account) and a
--     critical-risk flag a manager may set while it is open;
--   * each control is a row of its own on the hierarchy of controls —
--     elimination, substitution, isolation, engineering, administrative, PPE —
--     planned or in place, stamped by the database when it goes in, withdrawn
--     only with a reason, never edited once in place, never deleted once in;
--   * the hazard's state is READ off its controls, never typed: no controls,
--     control pending, controlled, eliminated;
--   * a hazard report closes only once a control is in place.
-- Controls are put in by whoever runs the site (app.can_run_talks); the
-- labourer who reported the hazard reads them on their own report.
-- ============================================================================

alter table public.org_incident_causes drop constraint org_incident_causes_kind_check;
alter table public.org_incident_causes add constraint org_incident_causes_kind_check
  check (kind in ('root_cause', 'contributing_factor', 'hazard_type'));

alter table public.incidents add column hazard_type text;
alter table public.incidents add column critical_risk boolean not null default false;

create table public.hazard_controls (
  id                    uuid primary key default gen_random_uuid(),
  incident_id           uuid not null references public.incidents (id) on delete restrict,
  level                 text not null check (level in ('elimination', 'substitution', 'isolation', 'engineering', 'administrative', 'ppe')),
  description           text not null check (length(btrim(description)) > 0),
  status                text not null default 'planned' check (status in ('planned', 'in_place', 'withdrawn')),
  created_by            uuid not null references auth.users (id),
  created_at            timestamptz not null default now(),
  created_on_device_at  timestamptz not null default now(),
  in_place_by           uuid references auth.users (id),
  in_place_at           timestamptz,
  withdrawn_by          uuid references auth.users (id),
  withdrawn_at          timestamptz,
  withdrawn_reason      text
);
create index hazard_controls_idx on public.hazard_controls (incident_id, status);

-- The hazard's state, read off its controls. The TS twin is `controlState` in src/lib/incidents/controls.ts.
create or replace function public.hazard_control_state(p_incident uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.hazard_controls c where c.incident_id = p_incident and c.status = 'in_place' and c.level = 'elimination') then 'eliminated'
    when exists (select 1 from public.hazard_controls c where c.incident_id = p_incident and c.status = 'in_place') then 'controlled'
    when exists (select 1 from public.hazard_controls c where c.incident_id = p_incident and c.status = 'planned') then 'control_pending'
    else 'no_controls'
  end;
$$;
grant execute on function public.hazard_control_state(uuid) to authenticated;

create or replace function app.hazard_controls_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_closed boolean;
begin
  select (status = 'closed') into v_closed from public.incidents where id = coalesce(new.incident_id, old.incident_id);
  if v_closed is null then
    raise exception 'That report is not on the file.' using errcode = 'check_violation';
  end if;
  if v_closed then
    raise exception 'A closed report takes no more controls.' using errcode = 'check_violation';
  end if;
  new.description := btrim(new.description);
  new.withdrawn_reason := nullif(btrim(coalesce(new.withdrawn_reason, '')), '');
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    if new.status = 'withdrawn' then
      raise exception 'A control is withdrawn after it was in place, not born withdrawn.' using errcode = 'check_violation';
    end if;
    if new.status = 'in_place' then
      new.in_place_by := coalesce(auth.uid(), new.in_place_by); new.in_place_at := now();
    else
      new.in_place_by := null; new.in_place_at := null;
    end if;
    new.withdrawn_by := null; new.withdrawn_at := null; new.withdrawn_reason := null;
    return new;
  end if;
  if new.incident_id is distinct from old.incident_id or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at or new.created_on_device_at is distinct from old.created_on_device_at then
    raise exception 'A control stays on its report.' using errcode = 'check_violation';
  end if;
  if old.status = 'withdrawn' then
    raise exception 'A withdrawn control is frozen.' using errcode = 'check_violation';
  end if;
  if old.status = 'in_place' then
    if new.description is distinct from old.description or new.level is distinct from old.level
       or new.in_place_at is distinct from old.in_place_at or new.in_place_by is distinct from old.in_place_by then
      raise exception 'A control that is in place does not change; withdraw it with a reason and add another.' using errcode = 'check_violation';
    end if;
    if new.status = 'planned' then
      raise exception 'A control that is in place does not go back to planned; withdraw it with a reason.' using errcode = 'check_violation';
    end if;
    if new.status = 'withdrawn' then
      if new.withdrawn_reason is null then
        raise exception 'Say why the control was withdrawn.' using errcode = 'check_violation';
      end if;
      new.withdrawn_by := coalesce(auth.uid(), new.withdrawn_by); new.withdrawn_at := now();
    end if;
    return new;
  end if;
  -- planned: may be reworded, moved on the hierarchy, or put in place
  if new.status = 'withdrawn' then
    raise exception 'A planned control is removed, not withdrawn.' using errcode = 'check_violation';
  end if;
  if new.status = 'in_place' then
    new.in_place_by := coalesce(auth.uid(), new.in_place_by); new.in_place_at := now();
  else
    new.in_place_by := null; new.in_place_at := null;
  end if;
  new.withdrawn_by := null; new.withdrawn_at := null; new.withdrawn_reason := null;
  return new;
end; $$;
create trigger a_hazard_controls_before_write before insert or update on public.hazard_controls
  for each row execute function app.hazard_controls_before_write();

create or replace function app.hazard_controls_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'planned' then
    raise exception 'A control that was in place is part of the record and is not removed.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.incidents i where i.id = old.incident_id and i.status = 'closed') then
    raise exception 'A closed report keeps its controls.' using errcode = 'check_violation';
  end if;
  return old;
end; $$;
create trigger a_hazard_controls_before_delete before delete on public.hazard_controls
  for each row execute function app.hazard_controls_before_delete();

-- The report: hazard_type joins the frozen first account; critical_risk moves while open; a hazard closes once controlled.
create or replace function app.incidents_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.project_id is distinct from old.project_id or new.seq is distinct from old.seq
     or new.kind is distinct from old.kind or new.occurred_at is distinct from old.occurred_at
     or new.reported_at is distinct from old.reported_at or new.reported_on_device_at is distinct from old.reported_on_device_at
     or new.location is distinct from old.location or new.description is distinct from old.description
     or new.immediate_actions is distinct from old.immediate_actions or new.people_involved is distinct from old.people_involved
     or new.witnesses is distinct from old.witnesses or new.injured_name is distinct from old.injured_name
     or new.injury_type is distinct from old.injury_type or new.body_part is distinct from old.body_part
     or new.treatment is distinct from old.treatment or new.actual_severity is distinct from old.actual_severity
     or new.potential_severity is distinct from old.potential_severity or new.notifiable is distinct from old.notifiable
     or new.plant is distinct from old.plant or new.photo_urls is distinct from old.photo_urls
     or new.hazard_type is distinct from old.hazard_type
     or new.reported_by is distinct from old.reported_by or new.created_at is distinct from old.created_at then
    raise exception 'The report is the first account and does not change; add an update instead.' using errcode = 'check_violation';
  end if;
  if new.notified_at is distinct from old.notified_at and auth.uid() is not null then
    raise exception 'Whether the office was emailed is recorded by the server, not the phone.' using errcode = 'check_violation';
  end if;
  if old.status = 'closed' then
    if new.status <> 'closed' or new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by
       or new.critical_risk is distinct from old.critical_risk then
      raise exception 'A closed report is frozen.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.status = 'closed' then
    if exists (select 1 from public.incident_actions a where a.incident_id = old.id and a.done_at is null) then
      raise exception 'A report closes only when every corrective action is done.' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.incident_investigations v where v.incident_id = old.id and v.status <> 'signed_off') then
      raise exception 'A report with an investigation closes only when the investigation is signed off.' using errcode = 'check_violation';
    end if;
    if old.kind = 'hazard' and public.hazard_control_state(old.id) not in ('controlled', 'eliminated') then
      raise exception 'A hazard closes only once a control is in place.' using errcode = 'check_violation';
    end if;
    new.closed_at := now();
    new.closed_by := coalesce(auth.uid(), new.closed_by);
  else
    new.closed_at := null;
    new.closed_by := null;
  end if;
  return new;
end;
$$;

-- The first account tidies its hazard type like the rest.
create or replace function app.incidents_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('incidents:' || new.project_id::text));
  select coalesce(max(seq), 0) + 1 into new.seq from public.incidents where project_id = new.project_id;
  new.description := btrim(new.description);
  new.location := nullif(btrim(coalesce(new.location, '')), '');
  new.hazard_type := nullif(btrim(coalesce(new.hazard_type, '')), '');
  new.reported_at := now();
  new.status := 'open';
  new.closed_at := null;
  new.closed_by := null;
  new.notified_at := null;
  if new.occurred_at > now() + interval '1 hour' then
    raise exception 'The report says it happened in the future; check the time.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Access -------------------------------------------------------------------
alter table public.hazard_controls enable row level security;
create policy hazard_controls_select on public.hazard_controls
  for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id and app.is_project_member(i.project_id)));
create policy hazard_controls_reads_own_or_record on public.hazard_controls
  as restrictive for select to authenticated
  using (app.incident_readable(incident_id));
create policy hazard_controls_insert on public.hazard_controls
  for insert to authenticated
  with check (created_by = (select auth.uid())
              and exists (select 1 from public.incidents i where i.id = incident_id and app.can_run_talks(i.project_id)));
create policy hazard_controls_update on public.hazard_controls
  for update to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id and app.can_run_talks(i.project_id)))
  with check (exists (select 1 from public.incidents i where i.id = incident_id and app.can_run_talks(i.project_id)));
-- A planned control is removed only by whoever put it down.
create policy hazard_controls_delete_own_planned on public.hazard_controls
  for delete to authenticated
  using (created_by = (select auth.uid()) and status = 'planned'
         and exists (select 1 from public.incidents i where i.id = incident_id and app.can_run_talks(i.project_id)));
grant select, insert, update, delete on public.hazard_controls to authenticated;
grant all on public.hazard_controls to service_role;
