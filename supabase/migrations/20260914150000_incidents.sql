-- ============================================================================
-- Hazards, near misses and incidents, with corrective actions.
--
-- The third safety module. A report is made on the phone in a minute —
-- what happened, where, when, who, photos — and is frozen the moment it is
-- made: the first account is the evidence, and anything learned afterwards
-- is appended as an update, never written over it. Corrective actions hang
-- off the report with an owner and a due date; the database stamps when
-- each is done and refuses to close a report while an action is open. A
-- closed report is frozen entirely.
--
-- Who does what: anyone on gate/prestart duty (supervisor, admin, leading
-- hand) reports and adds updates; supervisors and admins manage actions and
-- close; the PM reads. Reports are numbered per job (INC-001…), the number
-- issued by the database at the moment of reporting.
-- ============================================================================

create or replace function app.can_manage_incidents(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project
       and pm.user_id = (select auth.uid())
       and pm.role::text in ('supervisor', 'admin')
  );
$$;
grant execute on function app.can_manage_incidents(uuid) to authenticated;

create table public.incidents (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects (id) on delete restrict,
  seq                    integer not null,
  kind                   text not null check (kind in ('hazard', 'near_miss', 'injury', 'plant_damage', 'property_damage', 'environmental', 'other')),
  occurred_at            timestamptz not null,
  reported_at            timestamptz not null default now(),
  reported_on_device_at  timestamptz not null default now(),
  location               text,
  description            text not null check (length(btrim(description)) > 0),
  immediate_actions      text,
  people_involved        text[] not null default '{}',
  witnesses              text[] not null default '{}',
  injured_name           text,
  injury_type            text,
  body_part              text,
  treatment              text check (treatment is null or treatment in ('none', 'first_aid', 'medical', 'hospital')),
  actual_severity        text check (actual_severity is null or actual_severity in ('low', 'medium', 'high', 'extreme')),
  potential_severity     text check (potential_severity is null or potential_severity in ('low', 'medium', 'high', 'extreme')),
  notifiable             boolean not null default false,
  plant                  text,
  photo_urls             text[] not null default '{}',
  reported_by            uuid not null references auth.users (id),
  -- A second key onto profiles so the report can name its reporter (as entries do).
  constraint incidents_reported_by_profiles_fkey foreign key (reported_by) references public.profiles (id),
  status                 text not null default 'open' check (status in ('open', 'investigating', 'closed')),
  closed_at              timestamptz,
  closed_by              uuid references auth.users (id),
  notified_at            timestamptz,
  created_at             timestamptz not null default now()
);
create unique index incidents_seq_idx on public.incidents (project_id, seq);
create index incidents_project_idx on public.incidents (project_id, status, occurred_at desc);

create table public.incident_updates (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references public.incidents (id) on delete restrict,
  kind         text not null default 'note' check (kind in ('note', 'investigation', 'root_cause', 'regulator', 'status')),
  body         text not null check (length(btrim(body)) > 0),
  photo_urls   text[] not null default '{}',
  created_by   uuid not null references auth.users (id),
  constraint incident_updates_created_by_profiles_fkey foreign key (created_by) references public.profiles (id),
  created_at   timestamptz not null default now()
);
create index incident_updates_idx on public.incident_updates (incident_id, created_at);

create table public.incident_actions (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references public.incidents (id) on delete restrict,
  action       text not null check (length(btrim(action)) > 0),
  owner_name   text,
  due_on       date,
  done_at      timestamptz,
  done_by      uuid references auth.users (id),
  done_note    text,
  created_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now()
);
create index incident_actions_idx on public.incident_actions (incident_id, done_at, due_on);

create or replace function app.incidents_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- One number per job, issued here, in order of reporting.
  perform pg_advisory_xact_lock(hashtext('incidents:' || new.project_id::text));
  select coalesce(max(seq), 0) + 1 into new.seq from public.incidents where project_id = new.project_id;
  new.description := btrim(new.description);
  new.location := nullif(btrim(coalesce(new.location, '')), '');
  new.reported_at := now();
  new.status := 'open';
  new.closed_at := null;
  new.closed_by := null;
  new.notified_at := null;
  if new.occurred_at > now() + interval '1 hour' then
    new.occurred_at := now();
  end if;
  return new;
end;
$$;
create trigger a_incidents_before_insert before insert on public.incidents
  for each row execute function app.incidents_before_insert();

create or replace function app.incidents_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The first account is frozen; only the lifecycle moves.
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
    new.closed_at := now();
    new.closed_by := coalesce(auth.uid(), new.closed_by);
  else
    new.closed_at := null;
    new.closed_by := null;
  end if;
  return new;
end;
$$;
create trigger a_incidents_before_update before update on public.incidents
  for each row execute function app.incidents_before_update();

create or replace function app.incident_updates_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.incidents i where i.id = new.incident_id and i.status = 'closed') then
    raise exception 'A closed report takes no more updates.' using errcode = 'check_violation';
  end if;
  new.body := btrim(new.body);
  return new;
end;
$$;
create trigger a_incident_updates_before_insert before insert on public.incident_updates
  for each row execute function app.incident_updates_before_insert();

create or replace function app.frozen_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'This record is never changed or removed.' using errcode = 'check_violation';
end;
$$;
create trigger a_incident_updates_frozen before update or delete on public.incident_updates
  for each row execute function app.frozen_row();

create or replace function app.incident_actions_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.incidents i where i.id = new.incident_id and i.status = 'closed') then
    raise exception 'A closed report takes no more actions.' using errcode = 'check_violation';
  end if;
  new.action := btrim(new.action);
  new.owner_name := nullif(btrim(coalesce(new.owner_name, '')), '');
  if tg_op = 'INSERT' then
    new.done_at := null; new.done_by := null; new.done_note := null;
    return new;
  end if;
  if old.done_at is not null then
    raise exception 'A done action is frozen.' using errcode = 'check_violation';
  end if;
  if new.incident_id is distinct from old.incident_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'An action stays on its report.' using errcode = 'check_violation';
  end if;
  if new.done_at is not null then
    new.done_at := now();
    new.done_by := coalesce(auth.uid(), new.done_by);
  else
    new.done_by := null; new.done_note := null;
  end if;
  return new;
end;
$$;
create trigger a_incident_actions_before_write before insert or update on public.incident_actions
  for each row execute function app.incident_actions_before_write();

alter table public.incidents enable row level security;
alter table public.incident_updates enable row level security;
alter table public.incident_actions enable row level security;

create policy incidents_select_member on public.incidents
  for select to authenticated using (app.is_project_member(project_id));
create policy incidents_insert_crew on public.incidents
  for insert to authenticated
  with check (app.can_run_talks(project_id) and reported_by = (select auth.uid()));
create policy incidents_update_managers on public.incidents
  for update to authenticated
  using (app.can_manage_incidents(project_id)) with check (app.can_manage_incidents(project_id));

create policy incident_updates_select_member on public.incident_updates
  for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id and app.is_project_member(i.project_id)));
create policy incident_updates_insert_crew on public.incident_updates
  for insert to authenticated
  with check (created_by = (select auth.uid())
              and exists (select 1 from public.incidents i where i.id = incident_id and app.can_run_talks(i.project_id)));

create policy incident_actions_select_member on public.incident_actions
  for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id and app.is_project_member(i.project_id)));
create policy incident_actions_write_managers on public.incident_actions
  for all to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id and app.can_manage_incidents(i.project_id)))
  with check (exists (select 1 from public.incidents i where i.id = incident_id and app.can_manage_incidents(i.project_id)));

grant select, insert, update on public.incidents to authenticated;
grant select, insert on public.incident_updates to authenticated;
grant select, insert, update, delete on public.incident_actions to authenticated;
grant all on public.incidents, public.incident_updates, public.incident_actions to service_role;

-- Photos: {project_id}/incident/{incident_id}/{file}, written by whoever reports.
create policy "incident photos writable by crew" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-photos'
    and (storage.foldername(name))[2] = 'incident'
    and app.can_run_talks(((storage.foldername(name))[1])::uuid)
  );
