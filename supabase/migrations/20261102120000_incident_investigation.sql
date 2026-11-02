-- ============================================================================
-- Incident investigation (README R178). The report stays the first account,
-- frozen; the investigation is a second document that unfolds after it:
--   * one per report, opened by a manager with a due date and an investigator;
--   * root causes and contributing factors from the company's own lists (plus
--     the built-in ones), each kept as the words at the time;
--   * the five whys, numbered;
--   * finished only with a summary, findings and at least one root cause;
--   * signed off by a manager with a drawn signature — then frozen entirely;
--   * confidential: readable by the job's managers alone, not the crew;
--   * a report that has an investigation closes only once it is signed off.
-- Actions raised while investigating stay on incident_actions — the register.
-- ============================================================================

-- The company's own cause lists. The built-in ones live in code; a record
-- keeps the label as it read when chosen, so retiring one changes nothing.
create table public.org_incident_causes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations (id) on delete restrict,
  kind        text not null check (kind in ('root_cause', 'contributing_factor')),
  key         text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  label       text not null check (length(btrim(label)) > 0),
  active      boolean not null default true,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);
create unique index org_incident_causes_key_idx on public.org_incident_causes (org_id, kind, key);

create table public.incident_investigations (
  id                  uuid primary key default gen_random_uuid(),
  incident_id         uuid not null references public.incidents (id) on delete restrict,
  project_id          uuid not null references public.projects (id) on delete restrict,
  status              text not null default 'open' check (status in ('open', 'finished', 'signed_off')),
  confidential        boolean not null default false,
  due_on              date,
  investigator_id     uuid references auth.users (id),
  investigator_name   text,
  summary             text,
  sequence_of_events  text,
  findings            text,
  opened_by           uuid not null references auth.users (id),
  opened_at           timestamptz not null default now(),
  finished_by         uuid references auth.users (id),
  finished_at         timestamptz,
  signed_off_by       uuid references auth.users (id),
  signed_off_at       timestamptz,
  signed_name         text,
  signature_path      text,
  updated_at          timestamptz not null default now(),
  constraint incident_investigations_one_per_report unique (incident_id),
  constraint incident_investigations_opened_by_profiles_fkey foreign key (opened_by) references public.profiles (id)
);
create index incident_investigations_project_idx on public.incident_investigations (project_id, status, due_on);

create table public.incident_causes (
  id                uuid primary key default gen_random_uuid(),
  investigation_id  uuid not null references public.incident_investigations (id) on delete restrict,
  kind              text not null check (kind in ('root_cause', 'contributing_factor')),
  cause_key         text not null check (cause_key ~ '^[a-z0-9_]{2,40}$'),
  cause_label       text not null check (length(btrim(cause_label)) > 0),
  detail            text,
  created_by        uuid not null references auth.users (id),
  created_at        timestamptz not null default now(),
  constraint incident_causes_once unique (investigation_id, kind, cause_key)
);

create table public.incident_whys (
  id                uuid primary key default gen_random_uuid(),
  investigation_id  uuid not null references public.incident_investigations (id) on delete restrict,
  seq               integer not null check (seq between 1 and 9),
  why               text not null check (length(btrim(why)) > 0),
  created_by        uuid not null references auth.users (id),
  created_at        timestamptz not null default now(),
  constraint incident_whys_seq unique (investigation_id, seq)
);

-- Who reads an investigation: a member of the job who reads the record, and
-- when it is confidential, only someone who manages incidents on that job.
create or replace function app.reads_investigation(p_investigation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.incident_investigations v
     where v.id = p_investigation
       and app.is_project_member(v.project_id)
       and app.reads_record(v.project_id)
       and (not v.confidential or app.can_manage_incidents(v.project_id))
  );
$$;

create or replace function app.incident_investigations_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_incident public.incidents%rowtype;
  v_org uuid;
begin
  select * into v_incident from public.incidents where id = new.incident_id;
  if v_incident.id is null then
    raise exception 'That report is not on the file.' using errcode = 'check_violation';
  end if;
  new.project_id := v_incident.project_id;
  new.summary := nullif(btrim(coalesce(new.summary, '')), '');
  new.sequence_of_events := nullif(btrim(coalesce(new.sequence_of_events, '')), '');
  new.findings := nullif(btrim(coalesce(new.findings, '')), '');
  new.investigator_name := nullif(btrim(coalesce(new.investigator_name, '')), '');
  new.signed_name := nullif(btrim(coalesce(new.signed_name, '')), '');
  select org_id into v_org from public.projects where id = new.project_id;
  if new.investigator_id is not null and not app.action_assignee_ok(v_org, new.project_id, new.investigator_id) then
    raise exception 'The investigator is someone on the job.' using errcode = 'check_violation';
  end if;
  new.updated_at := now();

  if tg_op = 'INSERT' then
    if v_incident.status = 'closed' then
      raise exception 'A closed report takes no investigation.' using errcode = 'check_violation';
    end if;
    new.status := 'open';
    new.opened_by := coalesce(auth.uid(), new.opened_by);
    new.opened_at := now();
    new.finished_by := null; new.finished_at := null;
    new.signed_off_by := null; new.signed_off_at := null; new.signed_name := null; new.signature_path := null;
    return new;
  end if;

  if old.status = 'signed_off' then
    raise exception 'A signed-off investigation is frozen.' using errcode = 'check_violation';
  end if;
  if new.incident_id is distinct from old.incident_id or new.opened_by is distinct from old.opened_by or new.opened_at is distinct from old.opened_at then
    raise exception 'An investigation stays on its report.' using errcode = 'check_violation';
  end if;

  if new.status = 'open' then
    new.finished_by := null; new.finished_at := null;
    new.signed_off_by := null; new.signed_off_at := null; new.signed_name := null; new.signature_path := null;
    return new;
  end if;

  -- Finishing: the three things an investigation must say.
  if new.summary is null or new.findings is null
     or not exists (select 1 from public.incident_causes c where c.investigation_id = old.id and c.kind = 'root_cause') then
    raise exception 'An investigation finishes with a summary, findings and at least one root cause.' using errcode = 'check_violation';
  end if;
  if old.status = 'open' or new.status = 'finished' then
    if new.status = 'signed_off' and old.status = 'open' then
      raise exception 'Finish the investigation before signing it off.' using errcode = 'check_violation';
    end if;
    if old.status = 'open' then
      new.finished_by := coalesce(auth.uid(), new.finished_by);
      new.finished_at := now();
    else
      new.finished_by := old.finished_by; new.finished_at := old.finished_at;
    end if;
    new.signed_off_by := null; new.signed_off_at := null; new.signed_name := null; new.signature_path := null;
    return new;
  end if;

  -- Signing off: finished, a name, and a drawn signature in this report's own folder.
  new.finished_by := old.finished_by; new.finished_at := old.finished_at;
  if new.signed_name is null then
    raise exception 'Sign-off carries the name of who signed.' using errcode = 'check_violation';
  end if;
  if new.signature_path is null or new.signature_path !~ ('^' || new.project_id::text || '/incident/' || new.incident_id::text || '/') then
    raise exception 'Sign-off carries a drawn signature, kept with the report.' using errcode = 'check_violation';
  end if;
  new.signed_off_by := coalesce(auth.uid(), new.signed_off_by);
  new.signed_off_at := now();
  return new;
end; $$;
create trigger a_incident_investigations_before_write before insert or update on public.incident_investigations
  for each row execute function app.incident_investigations_before_write();

-- Opening an investigation moves the report to investigating; the report's own guard allows that move.
create or replace function app.incident_investigations_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.incidents set status = 'investigating' where id = new.incident_id and status = 'open';
  return new;
end; $$;
create trigger b_incident_investigations_after_insert after insert on public.incident_investigations
  for each row execute function app.incident_investigations_after_insert();

create or replace function app.incident_investigations_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'An investigation is never removed; reopen it or leave it.' using errcode = 'check_violation';
end; $$;
create trigger a_incident_investigations_before_delete before delete on public.incident_investigations
  for each row execute function app.incident_investigations_before_delete();

-- Causes and whys: the investigation's working parts, editable until it is signed off.
create or replace function app.investigation_parts_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_id uuid := case when tg_op = 'DELETE' then old.investigation_id else new.investigation_id end;
begin
  select status into v_status from public.incident_investigations where id = v_id;
  if v_status is null then
    raise exception 'That investigation is not on the file.' using errcode = 'check_violation';
  end if;
  if v_status = 'signed_off' then
    raise exception 'A signed-off investigation is frozen.' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and new.investigation_id is distinct from old.investigation_id then
    raise exception 'A finding stays on its investigation.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by; new.created_at := old.created_at;
  end if;
  if tg_table_name = 'incident_causes' then
    new.cause_label := btrim(new.cause_label);
    new.detail := nullif(btrim(coalesce(new.detail, '')), '');
  else
    new.why := btrim(new.why);
  end if;
  return new;
end; $$;
create trigger a_incident_causes_before_write before insert or update or delete on public.incident_causes
  for each row execute function app.investigation_parts_before_write();
create trigger a_incident_whys_before_write before insert or update or delete on public.incident_whys
  for each row execute function app.investigation_parts_before_write();

-- The report closes only once its investigation, if it has one, is signed off.
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
     or new.reported_by is distinct from old.reported_by or new.created_at is distinct from old.created_at then
    raise exception 'The report is the first account and does not change; add an update instead.' using errcode = 'check_violation';
  end if;
  if new.notified_at is distinct from old.notified_at and auth.uid() is not null then
    raise exception 'Whether the office was emailed is recorded by the server, not the phone.' using errcode = 'check_violation';
  end if;
  if old.status = 'closed' then
    if new.status <> 'closed' or new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by then
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
    new.closed_at := now();
    new.closed_by := coalesce(auth.uid(), new.closed_by);
  else
    new.closed_at := null;
    new.closed_by := null;
  end if;
  return new;
end;
$$;

-- Access -------------------------------------------------------------------
alter table public.org_incident_causes enable row level security;
alter table public.incident_investigations enable row level security;
alter table public.incident_causes enable row level security;
alter table public.incident_whys enable row level security;

create policy org_incident_causes_select on public.org_incident_causes
  for select to authenticated using (app.is_org_member(org_id));
create policy org_incident_causes_write on public.org_incident_causes
  for all to authenticated using (app.can_manage_crew(org_id)) with check (app.can_manage_crew(org_id));

create policy incident_investigations_select on public.incident_investigations
  for select to authenticated using (app.reads_investigation(id));
create policy incident_investigations_insert on public.incident_investigations
  for insert to authenticated
  with check (exists (select 1 from public.incidents i where i.id = incident_id and app.can_manage_incidents(i.project_id)));
create policy incident_investigations_update on public.incident_investigations
  for update to authenticated using (app.can_manage_incidents(project_id)) with check (app.can_manage_incidents(project_id));

create policy incident_causes_select on public.incident_causes
  for select to authenticated using (app.reads_investigation(investigation_id));
create policy incident_causes_write on public.incident_causes
  for all to authenticated
  using (exists (select 1 from public.incident_investigations v where v.id = investigation_id and app.can_manage_incidents(v.project_id)))
  with check (exists (select 1 from public.incident_investigations v where v.id = investigation_id and app.can_manage_incidents(v.project_id)));

create policy incident_whys_select on public.incident_whys
  for select to authenticated using (app.reads_investigation(investigation_id));
create policy incident_whys_write on public.incident_whys
  for all to authenticated
  using (exists (select 1 from public.incident_investigations v where v.id = investigation_id and app.can_manage_incidents(v.project_id)))
  with check (exists (select 1 from public.incident_investigations v where v.id = investigation_id and app.can_manage_incidents(v.project_id)));

-- The record lock: a labourer reads none of it (README R75 pattern).
create policy incident_investigations_reads_record on public.incident_investigations
  as restrictive for select to authenticated using (app.reads_record(project_id));
create policy incident_causes_reads_record on public.incident_causes
  as restrictive for select to authenticated
  using (exists (select 1 from public.incident_investigations v where v.id = investigation_id and app.reads_record(v.project_id)));
create policy incident_whys_reads_record on public.incident_whys
  as restrictive for select to authenticated
  using (exists (select 1 from public.incident_investigations v where v.id = investigation_id and app.reads_record(v.project_id)));

grant select, insert, update, delete on public.org_incident_causes to authenticated;
grant select, insert, update on public.incident_investigations to authenticated;
grant select, insert, update, delete on public.incident_causes, public.incident_whys to authenticated;
grant all on public.org_incident_causes, public.incident_investigations, public.incident_causes, public.incident_whys to service_role;

-- Whether a report has an investigation at all — so the crew's screen can say "under investigation, confidential"
-- rather than "none", without reading a word of it. Any member of the job may ask.
create or replace function public.incident_has_investigation(p_incident uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.incident_investigations v
      join public.incidents i on i.id = v.incident_id
     where v.incident_id = p_incident and app.is_project_member(i.project_id)
  );
$$;
grant execute on function public.incident_has_investigation(uuid) to authenticated;
