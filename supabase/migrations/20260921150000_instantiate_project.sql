-- ============================================================================
-- A job stamped from the company's templates (README R92).
--
-- instantiate_project() attaches modules to a job and stamps every active
-- template item those modules hold, at the job's tier, onto the job's SETUP
-- BOARD: start gate items, hold points, submittals, SWMS to have, consumables
-- with par levels, risks, expected documents and the twelve folders. It only
-- adds what is missing, so it is safe to run again after a module is added
-- mid-job or the library grows. A stamped item is a snapshot — the library
-- changing later does not rewrite a job's board.
--
-- The board is the office's (pm/admin on the job): the brief keeps start gate
-- items, risks and submittals away from site roles, and nothing here is money
-- or contract text a supervisor needs. Items are ticked done or marked not
-- applicable, never deleted; the DB stamps who and when.
--
-- create_project() grows a tier, modules and a start date and calls
-- instantiate_project() itself, so a job born in the app starts stamped.
-- ============================================================================

alter table public.projects
  add column tier text not null default 'full' check (tier in ('light', 'full')),
  add column start_on date;
comment on column public.projects.tier is 'light: the ten things a purchase-order job needs (min_tier = light). full: everything the attached modules hold. Only ever rises.';
comment on column public.projects.start_on is 'The day the job starts on site; setup due dates count from it. Null until the office says.';

create table public.project_modules (
  project_id   uuid not null references public.projects (id) on delete cascade,
  module_key   text not null,
  attached_by  uuid references auth.users (id),
  attached_at  timestamptz not null default now(),
  primary key (project_id, module_key)
);
comment on table public.project_modules is 'Which template modules a job has attached. Core is always one of them. Attached through instantiate_project(); never detached.';

create table public.project_setup_items (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  template_item_id uuid references public.template_items (id),
  module_key       text,
  kind             text not null check (kind in ('start_gate', 'hold_point', 'submittal', 'swms', 'consumable', 'risk', 'document', 'folder')),
  category         text,
  title            text not null check (length(btrim(title)) > 0),
  detail           text,
  priority         text check (priority is null or priority in ('A', 'B', 'C')),
  owner_role       text check (owner_role is null or owner_role in ('office', 'site')),
  owner_name       text,
  due_offset_days  integer,
  due_on           date,
  unit             text,
  par_level        numeric(12,2) check (par_level is null or par_level >= 0),
  folder_no        integer check (folder_no is null or folder_no between 1 and 12),
  sort             integer not null default 100,
  origin           text not null default 'template' check (origin in ('template', 'manual', 'contract')),
  status           text not null default 'open' check (status in ('open', 'done', 'not_applicable')),
  status_note      text,
  evidence         text,
  done_at          timestamptz,
  done_by          uuid references auth.users (id),
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (project_id, template_item_id)
);
create index project_setup_items_board_idx on public.project_setup_items (project_id, kind, status, priority, due_on);
comment on table public.project_setup_items is 'A job''s setup board: what it starts with, stamped from the templates (or added by hand, or read from the contract). Done or not applicable, never deleted. README R92.';

create or replace function app.project_setup_items_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.title := regexp_replace(btrim(new.title), '\s+', ' ', 'g');
  new.category := nullif(regexp_replace(btrim(coalesce(new.category, '')), '\s+', ' ', 'g'), '');
  new.owner_name := nullif(regexp_replace(btrim(coalesce(new.owner_name, '')), '\s+', ' ', 'g'), '');
  new.detail := nullif(btrim(coalesce(new.detail, '')), '');
  new.unit := nullif(btrim(coalesce(new.unit, '')), '');
  new.status_note := nullif(btrim(coalesce(new.status_note, '')), '');
  new.evidence := nullif(btrim(coalesce(new.evidence, '')), '');
  if new.kind in ('document', 'folder') and new.folder_no is null then
    raise exception 'A document or folder item names its folder (1–12).' using errcode = 'check_violation';
  end if;
  if new.kind = 'consumable' and new.par_level is not null and new.unit is null then
    raise exception 'A par level needs a unit.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    -- Born open; the DB alone stamps done.
    new.status := 'open'; new.done_at := null; new.done_by := null;
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
  else
    if new.project_id <> old.project_id or new.template_item_id is distinct from old.template_item_id
       or new.origin <> old.origin or new.kind <> old.kind
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'A setup item stays what it was stamped as; mark it not applicable instead.' using errcode = 'check_violation';
    end if;
    if new.status <> old.status then
      if new.status = 'open' then
        new.done_at := null; new.done_by := null;
      else
        new.done_at := now(); new.done_by := coalesce((select auth.uid()), new.done_by);
      end if;
    else
      new.done_at := old.done_at; new.done_by := old.done_by;
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;
create trigger a_project_setup_items_before_write before insert or update on public.project_setup_items
  for each row execute function app.project_setup_items_before_write();
create trigger a_project_setup_items_no_delete before delete on public.project_setup_items
  for each row execute function app.frozen_row();
create trigger a_project_modules_no_delete before delete on public.project_modules
  for each row execute function app.frozen_row();

-- ---------------------------------------------------------------------------
-- Stamp a job from the templates. Additive and idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.instantiate_project(p_project uuid, p_modules text[] default '{}', p_tier text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org     uuid;
  v_tier    text;
  v_start   date;
  v_mod     text;
  v_added   integer := 0;
  v_by_kind jsonb := '{}'::jsonb;
begin
  select org_id, tier, start_on into v_org, v_tier, v_start from public.projects where id = p_project;
  if v_org is null then
    raise exception 'No such job.' using errcode = 'no_data_found';
  end if;
  -- The office sets a job up. A null uid is the service role (create_project's own call, the operator path).
  if (select auth.uid()) is not null and not app.is_office(p_project) then
    raise exception 'Only the office — a PM or admin on the job — sets it up from the templates.' using errcode = 'insufficient_privilege';
  end if;
  if p_tier is not null then
    if p_tier not in ('light', 'full') then
      raise exception 'A job''s tier is light or full.' using errcode = 'check_violation';
    end if;
    -- A tier only rises: stamping more is additive; stamping less would mean taking things off the board.
    if p_tier = 'full' and v_tier = 'light' then
      update public.projects set tier = 'full' where id = p_project;
      v_tier := 'full';
    end if;
  end if;

  foreach v_mod in array (array['core'] || coalesce(p_modules, '{}'::text[])) loop
    if not exists (select 1 from public.template_modules m where m.org_id = v_org and m.key = v_mod and m.active) then
      raise exception 'This company''s templates have no module called %.', v_mod using errcode = 'check_violation';
    end if;
    insert into public.project_modules (project_id, module_key, attached_by)
    values (p_project, v_mod, (select auth.uid()))
    on conflict do nothing;
  end loop;

  with stamped as (
    insert into public.project_setup_items
      (project_id, template_item_id, module_key, kind, category, title, detail, priority, owner_role,
       due_offset_days, due_on, unit, par_level, folder_no, sort, origin, created_by)
    select p_project, t.id, t.module_key, t.kind, t.category, t.title, t.detail, t.priority, t.owner_role,
           t.due_offset_days,
           case when v_start is not null and t.due_offset_days is not null then v_start + t.due_offset_days end,
           t.unit, t.par_level, t.folder_no, t.sort, 'template', (select auth.uid())
      from public.template_items t
      join public.project_modules pm on pm.project_id = p_project and pm.module_key = t.module_key
     where t.org_id = v_org
       and t.active
       and (v_tier = 'full' or t.min_tier = 'light')
       and not exists (select 1 from public.project_setup_items s where s.project_id = p_project and s.template_item_id = t.id)
     order by t.module_key, t.kind, t.sort, t.title
    returning kind
  ), per_kind as (
    select kind, count(*)::integer as n from stamped group by kind
  )
  select coalesce(sum(n), 0)::integer, coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
    into v_added, v_by_kind
    from per_kind;

  return jsonb_build_object(
    'added', v_added,
    'by_kind', v_by_kind,
    'tier', v_tier,
    'modules', (select jsonb_agg(module_key order by module_key) from public.project_modules where project_id = p_project)
  );
end; $$;
revoke all on function public.instantiate_project(uuid, text[], text) from public, anon;
grant execute on function public.instantiate_project(uuid, text[], text) to authenticated, service_role;
comment on function public.instantiate_project is 'Attach modules (core always) and stamp the job''s setup board from the company''s active template items at the job''s tier. Adds only what is missing; never removes. Office only.';

-- The start date, and the due dates that count from it.
create or replace function public.set_project_start(p_project uuid, p_start_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not app.is_office(p_project) then
    raise exception 'Only the office sets the job''s start date.' using errcode = 'insufficient_privilege';
  end if;
  update public.projects set start_on = p_start_on where id = p_project;
  if not found then
    raise exception 'No such job.' using errcode = 'no_data_found';
  end if;
  -- Open items with an offset follow the start date; a finished item keeps the date it was finished against.
  update public.project_setup_items
     set due_on = case when p_start_on is null then null else p_start_on + due_offset_days end
   where project_id = p_project and status = 'open' and due_offset_days is not null;
end; $$;
revoke all on function public.set_project_start(uuid, date) from public, anon;
grant execute on function public.set_project_start(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A job born in the app is born stamped. The signature grows tier, modules and
-- a start date; the old one goes so the RPC resolves to one function.
-- ---------------------------------------------------------------------------
drop function if exists public.create_project(uuid, text, text, text, double precision, double precision);
create or replace function public.create_project(
  p_org_id               uuid,
  p_name                 text,
  p_code                 text,
  p_principal_contractor text default null,
  p_site_lat             double precision default null,
  p_site_lng             double precision default null,
  p_tier                 text default 'full',
  p_modules              text[] default '{}',
  p_start_on             date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code    text := upper(btrim(coalesce(p_code, '')));
  v_name    text := btrim(coalesce(p_name, ''));
  v_project uuid;
  v_stamp   jsonb;
begin
  if length(v_name) = 0 then
    raise exception 'The project needs a name.' using errcode = 'check_violation';
  end if;
  if v_code !~ '^[A-Z0-9]{2,12}$' then
    raise exception 'The code must be 2–12 letters or digits, like C002.'
      using errcode = 'check_violation';
  end if;
  if coalesce(p_tier, 'full') not in ('light', 'full') then
    raise exception 'A job''s tier is light or full.' using errcode = 'check_violation';
  end if;

  -- Only an admin somewhere in THIS org opens its next job.
  if not exists (
    select 1
      from public.project_members pm
      join public.projects pr on pr.id = pm.project_id
     where pr.org_id = p_org_id
       and pm.user_id = auth.uid()
       and pm.role = 'admin'
  ) then
    raise exception 'Only an organisation admin can create a project.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.projects where org_id = p_org_id and code = v_code) then
    raise exception 'This organisation already has a project coded %.', v_code
      using errcode = 'unique_violation';
  end if;

  insert into public.projects (org_id, name, code, principal_contractor, site_lat, site_lng, tier, start_on)
  values (p_org_id, v_name, v_code, nullif(btrim(coalesce(p_principal_contractor, '')), ''),
          p_site_lat, p_site_lng, coalesce(p_tier, 'full'), p_start_on)
  returning id into v_project;

  insert into public.project_members (project_id, user_id, role)
  values (v_project, auth.uid(), 'admin');

  v_stamp := public.instantiate_project(v_project, p_modules, null);

  return jsonb_build_object('project_id', v_project, 'code', v_code, 'name', v_name, 'stamped', v_stamp);
end;
$$;
revoke all on function public.create_project(uuid, text, text, text, double precision, double precision, text, text[], date)
  from public, anon;
grant execute on function public.create_project(uuid, text, text, text, double precision, double precision, text, text[], date)
  to authenticated, service_role;
comment on function public.create_project is
  'A new job in an existing organisation, created by one of its admins, who is seated as the project''s first admin and whose job is stamped from the company''s templates at once. Organisations themselves are only created by the operator path.';

-- ---------------------------------------------------------------------------
-- Access: the office reads and writes the board; site roles do not see it.
-- ---------------------------------------------------------------------------
alter table public.project_modules enable row level security;
alter table public.project_setup_items enable row level security;
create policy project_modules_office_select on public.project_modules for select to authenticated using (app.is_office(project_id));
create policy project_modules_reads_record on public.project_modules as restrictive for select to authenticated using (app.reads_record(project_id));
create policy project_setup_items_office_select on public.project_setup_items for select to authenticated using (app.is_office(project_id));
create policy project_setup_items_office_insert on public.project_setup_items for insert to authenticated with check (app.is_office(project_id));
create policy project_setup_items_office_update on public.project_setup_items for update to authenticated using (app.is_office(project_id)) with check (app.is_office(project_id));
create policy project_setup_items_reads_record on public.project_setup_items as restrictive for select to authenticated using (app.reads_record(project_id));
grant select on public.project_modules to authenticated;
grant select, insert, update on public.project_setup_items to authenticated;
grant all on public.project_modules, public.project_setup_items to service_role;
