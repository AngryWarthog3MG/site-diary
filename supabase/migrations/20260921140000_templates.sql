-- ============================================================================
-- The company's templates: what every job starts with (README R91).
--
-- A template item is a start gate item, a hold point, a submittal, a SWMS to
-- have, a consumable with a par level, a risk, an expected document or one
-- of the twelve folders — belonging to a MODULE (core, earthworks, frp,
-- remote, landscape, irrigation), at a tier (light: the ten things a small
-- purchase-order job needs; full: everything). Attaching a module to a job
-- stamps its items onto that job; that stamping is Phase 1 proper and is not
-- here yet. This is the library and its editor, so the library can be filled
-- while the rest is built — and, later, so the closeout loop has somewhere
-- to promote a job's one-off items to.
--
-- Company data: read by every member of the organisation, written by the
-- office (pm and admin) anywhere in it. Never deleted — retired.
-- ============================================================================

create table public.template_modules (
  org_id      uuid not null references public.organisations (id) on delete restrict,
  key         text not null check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name        text not null check (length(btrim(name)) > 0),
  description text,
  sort        integer not null default 100,
  active      boolean not null default true,
  primary key (org_id, key)
);

create table public.template_items (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations (id) on delete restrict,
  module_key       text not null,
  kind             text not null check (kind in ('start_gate', 'hold_point', 'submittal', 'swms', 'consumable', 'risk', 'document', 'folder')),
  category         text,
  title            text not null check (length(btrim(title)) > 0),
  detail           text,
  priority         text check (priority is null or priority in ('A', 'B', 'C')),
  min_tier         text not null default 'full' check (min_tier in ('light', 'full')),
  owner_role       text check (owner_role is null or owner_role in ('office', 'site')),
  due_offset_days  integer,
  unit             text,
  par_level        numeric(12,2) check (par_level is null or par_level >= 0),
  folder_no        integer check (folder_no is null or folder_no between 1 and 12),
  sort             integer not null default 100,
  active           boolean not null default true,
  origin           text not null default 'template' check (origin in ('template', 'manual', 'contract')),
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (org_id, module_key) references public.template_modules (org_id, key) on delete restrict
);
create index template_items_org_idx on public.template_items (org_id, module_key, kind, sort, title);

comment on table public.template_modules is
  'A company''s template modules: core is every job; the rest are attached per job. Empty shells until the library is filled.';
comment on table public.template_items is
  'What a job starts with, by module and kind. Retired, never deleted. Phase 1''s instantiate_project stamps these onto a job.';

create or replace function app.template_items_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.title := regexp_replace(btrim(new.title), '\s+', ' ', 'g');
  new.category := nullif(regexp_replace(btrim(coalesce(new.category, '')), '\s+', ' ', 'g'), '');
  new.detail := nullif(btrim(coalesce(new.detail, '')), '');
  new.unit := nullif(btrim(coalesce(new.unit, '')), '');
  if new.kind in ('document', 'folder') and new.folder_no is null then
    raise exception 'A document or folder item names its folder (1–12).' using errcode = 'check_violation';
  end if;
  if new.kind = 'consumable' and new.par_level is not null and new.unit is null then
    raise exception 'A par level needs a unit.' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
  else
    if new.org_id is distinct from old.org_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception 'A template item stays with its company.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end; $$;
create trigger a_template_items_before_write before insert or update on public.template_items
  for each row execute function app.template_items_before_write();
create trigger a_template_items_no_delete before delete on public.template_items
  for each row execute function app.frozen_row();
create trigger a_template_modules_no_delete before delete on public.template_modules
  for each row execute function app.frozen_row();

-- The office of a company: pm or admin on any of its jobs.
create or replace function app.is_org_office(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
     where p.org_id = p_org and pm.user_id = (select auth.uid()) and pm.role::text in ('pm', 'admin')
  );
$$;
grant execute on function app.is_org_office(uuid) to authenticated;

alter table public.template_modules enable row level security;
alter table public.template_items enable row level security;
create policy template_modules_select on public.template_modules for select to authenticated using (app.is_org_member(org_id));
create policy template_modules_write on public.template_modules for insert to authenticated with check (app.is_org_office(org_id));
create policy template_modules_update on public.template_modules for update to authenticated using (app.is_org_office(org_id)) with check (app.is_org_office(org_id));
create policy template_items_select on public.template_items for select to authenticated using (app.is_org_member(org_id));
create policy template_items_insert on public.template_items for insert to authenticated with check (app.is_org_office(org_id));
create policy template_items_update on public.template_items for update to authenticated using (app.is_org_office(org_id)) with check (app.is_org_office(org_id));
grant select, insert, update on public.template_modules, public.template_items to authenticated;
grant all on public.template_modules, public.template_items to service_role;

-- The six module shells the brief names, for every company. Core is always attached to a job.
insert into public.template_modules (org_id, key, name, description, sort)
select o.id, m.key, m.name, m.description, m.sort
  from public.organisations o
 cross join (values
   ('core',       'Core',        'Every job, whatever the work',                       10),
   ('earthworks', 'Earthworks',  'Bulk and detailed earthworks, drainage, compaction', 20),
   ('frp',        'FRP',         'Formwork, reinforcement, placement',                 30),
   ('remote',     'Remote',      'Away from Perth: travel, camp, supply lines',        40),
   ('landscape',  'Landscape',   'Soft and hard landscape',                            50),
   ('irrigation', 'Irrigation',  'Irrigation mainlines, laterals and controls',        60)
 ) as m(key, name, description, sort)
on conflict do nothing;
