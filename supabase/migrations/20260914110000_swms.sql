-- ============================================================================
-- SWMS and JSA: the method statement, and everyone who signed on to it.
--
-- A Safe Work Method Statement is required for high-risk construction work
-- (WHS Regulations r.291–299); a Job Safety Analysis is the same shape for a
-- task that is not high-risk. One table holds both, told apart by `kind`.
--
-- Lifecycle: a draft is written and edited by a supervisor or admin; "put
-- into use" checks it is complete and freezes it (status 'active'); workers
-- sign on to the active version, one signature each; a change is a new
-- version that supersedes the old one when it is put into use; an archived
-- SWMS stays readable with its sign-ons. Nothing on a frozen version
-- changes. A sign-on is a fact about a moment: it is never edited or deleted.
--
-- The database checks completeness at activation (at least one step with a
-- hazard and a control; a SWMS names its high-risk categories), the same
-- rule the screen shows — if they disagree, the database wins.
-- ============================================================================

create or replace function app.can_write_swms(p_project uuid)
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
grant execute on function app.can_write_swms(uuid) to authenticated;

create table public.swms (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete restrict,
  kind           text not null default 'swms' check (kind in ('swms', 'jsa')),
  title          text not null check (length(btrim(title)) > 0),
  activity       text,
  hrcw           text[] not null default '{}',
  ppe            text[] not null default '{}',
  permits        text,
  plant          text,
  legislation    text,
  prepared_by    text,
  reviewed_by    text,
  version        integer not null default 1 check (version >= 1),
  supersedes_id  uuid references public.swms (id),
  steps          jsonb not null default '[]'::jsonb,
  status         text not null default 'draft' check (status in ('draft', 'active', 'superseded', 'archived')),
  activated_at   timestamptz,
  activated_by   uuid references auth.users (id),
  archived_at    timestamptz,
  created_by     uuid not null references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index swms_project_idx on public.swms (project_id, status, kind, title);

create table public.swms_signons (
  id                   uuid primary key default gen_random_uuid(),
  swms_id              uuid not null references public.swms (id) on delete restrict,
  attendee_name        text not null check (length(btrim(attendee_name)) > 0),
  signature_path       text not null,
  signed_on_device_at  timestamptz not null default now(),
  created_by           uuid not null references auth.users (id),
  created_at           timestamptz not null default now()
);
create unique index swms_signons_one_per_person_idx on public.swms_signons (swms_id, lower(btrim(attendee_name)));

-- Is the method statement complete enough to be worked to?
create or replace function app.swms_problems(p public.swms)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_problems text[] := '{}';
  v_step jsonb;
  v_n integer := 0;
begin
  if jsonb_typeof(p.steps) <> 'array' or jsonb_array_length(p.steps) = 0 then
    v_problems := v_problems || 'no steps';
  else
    for v_step in select * from jsonb_array_elements(p.steps) loop
      v_n := v_n + 1;
      if length(btrim(coalesce(v_step ->> 'step', ''))) = 0 then v_problems := v_problems || format('step %s has no description', v_n); end if;
      if length(btrim(coalesce(v_step ->> 'hazards', ''))) = 0 then v_problems := v_problems || format('step %s names no hazard', v_n); end if;
      if length(btrim(coalesce(v_step ->> 'controls', ''))) = 0 then v_problems := v_problems || format('step %s has no control', v_n); end if;
    end loop;
  end if;
  if p.kind = 'swms' and coalesce(array_length(p.hrcw, 1), 0) = 0 then
    v_problems := v_problems || 'a SWMS must name its high-risk construction work';
  end if;
  if length(btrim(coalesce(p.prepared_by, ''))) = 0 then
    v_problems := v_problems || 'nobody is named as having prepared it';
  end if;
  return v_problems;
end;
$$;
grant execute on function app.swms_problems(public.swms) to authenticated;

create or replace function app.swms_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.title := btrim(new.title);
  -- Born a draft, whatever the phone says.
  new.status := 'draft';
  new.activated_at := null;
  new.activated_by := null;
  new.archived_at := null;
  if new.supersedes_id is not null then
    if not exists (select 1 from public.swms s where s.id = new.supersedes_id and s.project_id = new.project_id) then
      raise exception 'A revision must supersede a SWMS on the same job.' using errcode = 'check_violation';
    end if;
    select coalesce(max(s.version), 0) + 1 into new.version from public.swms s
     where s.project_id = new.project_id and (s.id = new.supersedes_id or s.supersedes_id = new.supersedes_id);
  end if;
  return new;
end;
$$;
create trigger a_swms_before_insert before insert on public.swms
  for each row execute function app.swms_before_insert();

create or replace function app.swms_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_problems text[];
begin
  new.updated_at := now();
  if old.status = 'draft' then
    if new.status = 'draft' then
      new.title := btrim(new.title);
      new.activated_at := null; new.activated_by := null; new.archived_at := null;
      return new;
    end if;
    if new.status <> 'active' then
      raise exception 'A draft is put into use or deleted; it is not archived.' using errcode = 'check_violation';
    end if;
    v_problems := app.swms_problems(new);
    if coalesce(array_length(v_problems, 1), 0) > 0 then
      raise exception 'Not ready to be worked to: %', array_to_string(v_problems, '; ') using errcode = 'check_violation';
    end if;
    new.title := btrim(new.title);
    new.activated_at := now();
    new.activated_by := coalesce(auth.uid(), new.created_by);
    new.archived_at := null;
    if new.supersedes_id is not null then
      update public.swms set status = 'superseded' where id = new.supersedes_id and status = 'active';
    end if;
    return new;
  end if;

  -- Frozen: only a status step forward, nothing on the content.
  if new.title is distinct from old.title or new.activity is distinct from old.activity
     or new.hrcw is distinct from old.hrcw or new.ppe is distinct from old.ppe
     or new.permits is distinct from old.permits or new.plant is distinct from old.plant
     or new.legislation is distinct from old.legislation or new.prepared_by is distinct from old.prepared_by
     or new.reviewed_by is distinct from old.reviewed_by or new.version is distinct from old.version
     or new.supersedes_id is distinct from old.supersedes_id or new.steps is distinct from old.steps
     or new.kind is distinct from old.kind or new.project_id is distinct from old.project_id
     or new.activated_at is distinct from old.activated_at or new.activated_by is distinct from old.activated_by
     or new.created_by is distinct from old.created_by then
    raise exception 'This SWMS is in use and frozen; revise it instead.' using errcode = 'check_violation';
  end if;
  if old.status = 'active' and new.status in ('superseded', 'archived') then
    new.archived_at := case when new.status = 'archived' then now() else null end;
    return new;
  end if;
  if new.status = old.status then return new; end if;
  raise exception 'A % SWMS does not become %.', old.status, new.status using errcode = 'check_violation';
end;
$$;
create trigger a_swms_before_update before update on public.swms
  for each row execute function app.swms_before_update();

-- Sign-ons attach only to a SWMS that is in use, and never change.
create or replace function app.can_sign_swms(p_swms uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.swms s
     where s.id = p_swms and s.status = 'active' and app.can_run_talks(s.project_id)
  );
$$;
grant execute on function app.can_sign_swms(uuid) to authenticated;

create or replace function app.swms_signons_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_swms public.swms;
begin
  select * into v_swms from public.swms where id = new.swms_id;
  if not found or v_swms.status <> 'active' then
    raise exception 'Sign-ons go on a SWMS that is in use.' using errcode = 'check_violation';
  end if;
  new.attendee_name := btrim(new.attendee_name);
  if split_part(new.signature_path, '/', 1) <> v_swms.project_id::text
     or split_part(new.signature_path, '/', 2) <> 'swms'
     or split_part(new.signature_path, '/', 3) <> new.swms_id::text then
    raise exception 'The signature must be stored in this SWMS''s own folder.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger a_swms_signons_before_insert before insert on public.swms_signons
  for each row execute function app.swms_signons_before_insert();

create or replace function app.swms_signons_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'A sign-on is never changed or removed.' using errcode = 'check_violation';
end;
$$;
create trigger a_swms_signons_frozen before update or delete on public.swms_signons
  for each row execute function app.swms_signons_frozen();

alter table public.swms enable row level security;
alter table public.swms_signons enable row level security;

create policy swms_select_member on public.swms
  for select to authenticated using (app.is_project_member(project_id));
create policy swms_insert_writer on public.swms
  for insert to authenticated
  with check (app.can_write_swms(project_id) and created_by = (select auth.uid()));
create policy swms_update_writer on public.swms
  for update to authenticated
  using (app.can_write_swms(project_id)) with check (app.can_write_swms(project_id));
create policy swms_delete_draft on public.swms
  for delete to authenticated
  using (status = 'draft' and app.can_write_swms(project_id));

create policy swms_signons_select_member on public.swms_signons
  for select to authenticated
  using (exists (select 1 from public.swms s where s.id = swms_id and app.is_project_member(s.project_id)));
create policy swms_signons_insert_crew on public.swms_signons
  for insert to authenticated
  with check (app.can_sign_swms(swms_id) and created_by = (select auth.uid()));

grant select, insert, update, delete on public.swms to authenticated;
grant select, insert on public.swms_signons to authenticated;
grant all on public.swms, public.swms_signons to service_role;

-- Signatures: {project_id}/swms/{swms_id}/sig-{signon_id}.png, writable while the SWMS is in use.
create policy "swms signatures writable while in use" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-photos'
    and (storage.foldername(name))[2] = 'swms'
    and app.can_sign_swms(((storage.foldername(name))[3])::uuid)
  );
