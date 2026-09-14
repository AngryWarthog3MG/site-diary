-- ============================================================================
-- Inspections and audits: a checklist walked on the phone, signed, frozen.
--
-- The fourth safety module. The company keeps its templates (a site walk,
-- an environmental check, a quality check, a plant audit — or its own);
-- an inspection copies the template's items at the moment it starts, so the
-- printed record says what was asked that day even if the template changes
-- later. Each item is OK, an issue, or not applicable; an issue carries a
-- note and photographs. The signature completes the inspection and the
-- database freezes it. Issues become corrective actions in the same shape
-- as an incident's — owner, due date, done stamped by the database.
-- ============================================================================

create table public.inspection_templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations (id) on delete restrict,
  name        text not null check (length(btrim(name)) > 0),
  kind        text not null default 'site' check (kind in ('site', 'environmental', 'quality', 'plant', 'other')),
  items       jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index inspection_templates_org_idx on public.inspection_templates (org_id, active, name);

create table public.inspections (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.projects (id) on delete restrict,
  template_id             uuid references public.inspection_templates (id),
  template_name           text not null check (length(btrim(template_name)) > 0),
  kind                    text not null default 'site' check (kind in ('site', 'environmental', 'quality', 'plant', 'other')),
  inspection_date         date not null,
  area                    text,
  inspector_name          text not null check (length(btrim(inspector_name)) > 0),
  items                   jsonb not null default '[]'::jsonb,
  summary                 text,
  signature_path          text,
  completed_at            timestamptz,
  completed_on_device_at  timestamptz,
  conducted_by            uuid not null references auth.users (id),
  created_at              timestamptz not null default now()
);
create index inspections_project_idx on public.inspections (project_id, inspection_date desc);

create table public.inspection_actions (
  id             uuid primary key default gen_random_uuid(),
  inspection_id  uuid not null references public.inspections (id) on delete restrict,
  item_key       text,
  action         text not null check (length(btrim(action)) > 0),
  owner_name     text,
  due_on         date,
  done_at        timestamptz,
  done_by        uuid references auth.users (id),
  done_note      text,
  created_by     uuid not null references auth.users (id),
  created_at     timestamptz not null default now()
);
create index inspection_actions_idx on public.inspection_actions (inspection_id, done_at, due_on);

create or replace function app.inspection_templates_touch()
returns trigger language plpgsql set search_path = '' as $$
begin new.name := btrim(new.name); new.updated_at := now(); return new; end; $$;
create trigger a_inspection_templates_touch before insert or update on public.inspection_templates
  for each row execute function app.inspection_templates_touch();

create or replace function app.inspection_answered(p_items jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select count(*)::integer from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) i
   where i ->> 'result' in ('ok', 'issue', 'na');
$$;

create or replace function app.inspections_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.template_name := btrim(new.template_name);
  new.inspector_name := btrim(new.inspector_name);
  new.area := nullif(btrim(coalesce(new.area, '')), '');
  -- Born open: the signature comes through an update, checked below.
  new.signature_path := null;
  new.completed_at := null;
  new.completed_on_device_at := null;
  return new;
end;
$$;
create trigger a_inspections_before_insert before insert on public.inspections
  for each row execute function app.inspections_before_insert();

create or replace function app.inspections_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.completed_at is not null then
    raise exception 'This inspection is signed and frozen.' using errcode = 'check_violation';
  end if;
  if new.project_id is distinct from old.project_id or new.conducted_by is distinct from old.conducted_by
     or new.created_at is distinct from old.created_at or new.template_id is distinct from old.template_id then
    raise exception 'An inspection keeps its job and who started it.' using errcode = 'check_violation';
  end if;
  new.completed_at := null;
  if new.signature_path is not null then
    if app.inspection_answered(new.items) = 0 then
      raise exception 'Nothing was checked: no item has an answer.' using errcode = 'check_violation';
    end if;
    if split_part(new.signature_path, '/', 1) <> new.project_id::text
       or split_part(new.signature_path, '/', 2) <> 'inspection'
       or split_part(new.signature_path, '/', 3) <> new.id::text then
      raise exception 'The signature must be stored in this inspection''s own folder.' using errcode = 'check_violation';
    end if;
    new.completed_at := now();
    new.completed_on_device_at := coalesce(new.completed_on_device_at, now());
  else
    new.completed_on_device_at := null;
  end if;
  return new;
end;
$$;
create trigger a_inspections_before_update before update on public.inspections
  for each row execute function app.inspections_before_update();

create or replace function app.inspection_actions_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.action := btrim(new.action);
  new.owner_name := nullif(btrim(coalesce(new.owner_name, '')), '');
  if tg_op = 'INSERT' then
    new.done_at := null; new.done_by := null; new.done_note := null;
    return new;
  end if;
  if old.done_at is not null then
    raise exception 'A done action is frozen.' using errcode = 'check_violation';
  end if;
  if new.inspection_id is distinct from old.inspection_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'An action stays on its inspection.' using errcode = 'check_violation';
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
create trigger a_inspection_actions_before_write before insert or update on public.inspection_actions
  for each row execute function app.inspection_actions_before_write();

create or replace function app.inspection_actions_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.done_at is not null then
    raise exception 'A done action is part of the record and is not removed.' using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
create trigger a_inspection_actions_before_delete before delete on public.inspection_actions
  for each row execute function app.inspection_actions_before_delete();

alter table public.inspection_templates enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_actions enable row level security;

create policy inspection_templates_select_org on public.inspection_templates
  for select to authenticated using (app.is_org_member(org_id));
create policy inspection_templates_write_managers on public.inspection_templates
  for all to authenticated
  using (app.can_manage_crew(org_id)) with check (app.can_manage_crew(org_id));

create policy inspections_select_member on public.inspections
  for select to authenticated using (app.is_project_member(project_id));
create policy inspections_insert_crew on public.inspections
  for insert to authenticated
  with check (app.can_run_talks(project_id) and conducted_by = (select auth.uid()));
create policy inspections_update_open on public.inspections
  for update to authenticated
  using (app.can_run_talks(project_id) and completed_at is null)
  with check (app.can_run_talks(project_id));
create policy inspections_delete_own_open on public.inspections
  for delete to authenticated
  using (conducted_by = (select auth.uid()) and completed_at is null and app.can_run_talks(project_id));

create policy inspection_actions_select_member on public.inspection_actions
  for select to authenticated
  using (exists (select 1 from public.inspections i where i.id = inspection_id and app.is_project_member(i.project_id)));
create policy inspection_actions_insert_managers on public.inspection_actions
  for insert to authenticated
  with check (created_by = (select auth.uid())
              and exists (select 1 from public.inspections i where i.id = inspection_id and app.can_manage_incidents(i.project_id)));
create policy inspection_actions_update_managers on public.inspection_actions
  for update to authenticated
  using (exists (select 1 from public.inspections i where i.id = inspection_id and app.can_manage_incidents(i.project_id)))
  with check (exists (select 1 from public.inspections i where i.id = inspection_id and app.can_manage_incidents(i.project_id)));
create policy inspection_actions_delete_own_open on public.inspection_actions
  for delete to authenticated
  using (created_by = (select auth.uid()) and done_at is null
         and exists (select 1 from public.inspections i where i.id = inspection_id and app.can_manage_incidents(i.project_id)));

grant select, insert, update, delete on public.inspection_templates to authenticated;
grant select, insert, update, delete on public.inspections to authenticated;
grant select, insert, update, delete on public.inspection_actions to authenticated;
grant all on public.inspection_templates, public.inspections, public.inspection_actions to service_role;

-- Photos and the signature: {project_id}/inspection/{inspection_id}/{file}.
create policy "inspection files writable by crew" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-photos'
    and (storage.foldername(name))[2] = 'inspection'
    and app.can_run_talks(((storage.foldername(name))[1])::uuid)
  );
