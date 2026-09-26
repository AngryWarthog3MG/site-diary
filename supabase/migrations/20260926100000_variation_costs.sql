-- Variation costing (README R104): a rate card, and a build-up of costed lines per variation.
--
-- Mitchell: "add dollar figures to each line item — if we use a labourer, that labourer's hourly rate needs to be on
-- there with the hours; if we use a machine, what machine and what the rate was — all within a central portal linked
-- to the variations tab, with the financials in the variation tab so we can see at a glance how much we are claiming."
--
-- 1. rate_items: the charge-out rates. A company rate (project null) and, where a head contract's schedule differs,
--    the job's own (project set), which wins for that job. Office writes them (pm/admin); the people who price
--    variations read them (supervisor/pm/admin). Never deleted — retired. Every change is kept in rate_item_changes.
-- 2. variation_cost_lines: the build-up. Quantity × rate, the amount worked out HERE (a generated column), never
--    typed. The rate is copied onto the line when it is added, so changing the rate card later does not move a
--    variation already priced. A blank quantity or rate is a blank, not 0: the amount stays null and the screen asks.
-- 3. The build-up IS the variation's estimate: while a variation has lines, its estimated_cost is their total and
--    estimate_source says so; set_variation_details cannot type over it.
-- 4. Submitted is what was claimed: lines only change while the variation is raised or priced, and the status event
--    that records the submission stamps the total and the line count as they stood.

-- ---------------------------------------------------------------------------------------------------------------
-- Who may do what.

create or replace function app.can_read_rates(p_org uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_project is not null then app.can_manage_registers(p_project)
    else exists (
      select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
       where p.org_id = p_org and pm.user_id = (select auth.uid()) and pm.role::text in ('supervisor', 'pm', 'admin'))
  end;
$$;
grant execute on function app.can_read_rates(uuid, uuid) to authenticated;

create or replace function app.can_write_rates(p_org uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_project is not null then app.is_office(p_project) else app.is_org_office(p_org) end;
$$;
grant execute on function app.can_write_rates(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. The rate card.

create table public.rate_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations (id) on delete cascade,
  project_id  uuid references public.projects (id) on delete cascade,
  kind        text not null check (kind in ('labour', 'plant', 'material', 'other')),
  label       text not null check (btrim(label) <> ''),
  plant_id    uuid references public.plant_register (id),
  unit        text not null default 'hour' check (btrim(unit) <> ''),
  rate        numeric(12,2) not null check (rate >= 0),
  notes       text,
  active      boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint rate_items_machine_on_plant check (plant_id is null or kind = 'plant')
);
create unique index rate_items_one_live_label
  on public.rate_items (org_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, lower(label))
  where active;
create index rate_items_org on public.rate_items (org_id);
create index rate_items_project on public.rate_items (project_id) where project_id is not null;

create table public.rate_item_changes (
  id            bigint generated always as identity primary key,
  rate_item_id  uuid not null references public.rate_items (id) on delete cascade,
  org_id        uuid not null,
  project_id    uuid,
  old_label     text, new_label text,
  old_unit      text, new_unit text,
  old_rate      numeric(12,2), new_rate numeric(12,2),
  old_active    boolean, new_active boolean,
  changed_by    uuid,
  changed_at    timestamptz not null default now()
);
create index rate_item_changes_item on public.rate_item_changes (rate_item_id);

create or replace function app.rate_items_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.label := btrim(regexp_replace(new.label, '\s+', ' ', 'g'));
  new.unit := btrim(regexp_replace(new.unit, '\s+', ' ', 'g'));
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  if tg_op = 'UPDATE' then
    if new.org_id is distinct from old.org_id or new.project_id is distinct from old.project_id or new.kind is distinct from old.kind then
      raise exception 'A rate keeps its company, its job and its kind. Retire it and add a new one.' using errcode = 'check_violation';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  if new.project_id is not null and not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'That job is not this company''s.' using errcode = 'check_violation';
  end if;
  if new.plant_id is not null and not exists (select 1 from public.plant_register pr where pr.id = new.plant_id and pr.org_id = new.org_id) then
    raise exception 'That machine is not on this company''s plant register.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger rate_items_before_write before insert or update on public.rate_items
  for each row execute function app.rate_items_before_write();

create or replace function app.rate_items_log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.label is distinct from old.label or new.unit is distinct from old.unit
     or new.rate is distinct from old.rate or new.active is distinct from old.active then
    insert into public.rate_item_changes (rate_item_id, org_id, project_id, old_label, new_label, old_unit, new_unit, old_rate, new_rate, old_active, new_active, changed_by)
    values (new.id, new.org_id, new.project_id, old.label, new.label, old.unit, new.unit, old.rate, new.rate, old.active, new.active, auth.uid());
  end if;
  return null;
end;
$$;
create trigger rate_items_log_change after update on public.rate_items
  for each row execute function app.rate_items_log_change();

alter table public.rate_items enable row level security;
alter table public.rate_item_changes enable row level security;
create policy rate_items_select on public.rate_items for select to authenticated using (app.can_read_rates(org_id, project_id));
create policy rate_items_insert on public.rate_items for insert to authenticated with check (app.can_write_rates(org_id, project_id));
create policy rate_items_update on public.rate_items for update to authenticated
  using (app.can_write_rates(org_id, project_id)) with check (app.can_write_rates(org_id, project_id));
create policy rate_items_reads_record on public.rate_items as restrictive for select to authenticated using (app.reads_org_record(org_id));
create policy rate_item_changes_select on public.rate_item_changes for select to authenticated using (app.can_read_rates(org_id, project_id));
create policy rate_item_changes_reads_record on public.rate_item_changes as restrictive for select to authenticated using (app.reads_org_record(org_id));
grant select, insert, update on public.rate_items to authenticated;
grant select on public.rate_item_changes to authenticated;
grant all on public.rate_items, public.rate_item_changes to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. The build-up.

alter table public.variation_register
  add column estimate_source text not null default 'manual' check (estimate_source in ('manual', 'build_up'));

create table public.variation_cost_lines (
  id               uuid primary key default gen_random_uuid(),
  register_id      uuid not null references public.variation_register (id) on delete cascade,
  project_id       uuid not null references public.projects (id),
  kind             text not null check (kind in ('labour', 'plant', 'material', 'other')),
  description      text not null check (btrim(description) <> ''),
  person_name      text,
  plant_id         uuid references public.plant_register (id),
  rate_item_id     uuid references public.rate_items (id),
  source_entry_id  uuid references public.entries (id) on delete set null,
  work_date        date,
  quantity         numeric(12,2) check (quantity is null or quantity >= 0),
  unit             text not null default 'hour' check (btrim(unit) <> ''),
  rate             numeric(12,2) check (rate is null or rate >= 0),
  amount           numeric(14,2) generated always as (round(quantity * rate, 2)) stored,
  note             text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint variation_cost_lines_person_on_labour check (person_name is null or kind = 'labour'),
  constraint variation_cost_lines_machine_on_plant check (plant_id is null or kind = 'plant')
);
create index variation_cost_lines_register on public.variation_cost_lines (register_id);
create index variation_cost_lines_project on public.variation_cost_lines (project_id);
-- A diary day's person is brought in once; a day with no names, once.
create unique index variation_cost_lines_one_per_person_day
  on public.variation_cost_lines (register_id, source_entry_id, lower(person_name))
  where kind = 'labour' and source_entry_id is not null and person_name is not null;
create unique index variation_cost_lines_one_unnamed_day
  on public.variation_cost_lines (register_id, source_entry_id)
  where kind = 'labour' and source_entry_id is not null and person_name is null;

create or replace function app.variation_cost_lines_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_reg public.variation_register;
  v_register uuid := case when tg_op = 'DELETE' then old.register_id else new.register_id end;
  v_org uuid;
begin
  select * into v_reg from public.variation_register where id = v_register;
  if not found then
    -- The item itself is being removed (its lines go with it), or it never existed.
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'No such variation on the register.' using errcode = 'foreign_key_violation';
  end if;
  if v_reg.status::text not in ('raised', 'priced') then
    raise exception 'V-% has been %: its build-up is what was claimed. Move it back to Priced to change it — the history keeps both.',
      lpad(v_reg.seq::text, 3, '0'), v_reg.status using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' then
    if new.register_id is distinct from old.register_id then
      raise exception 'A line stays on its variation. Remove it and add it to the other.' using errcode = 'check_violation';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.project_id := v_reg.project_id;
  new.description := btrim(regexp_replace(new.description, '\s+', ' ', 'g'));
  new.person_name := nullif(btrim(regexp_replace(coalesce(new.person_name, ''), '\s+', ' ', 'g')), '');
  new.unit := btrim(regexp_replace(new.unit, '\s+', ' ', 'g'));
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.updated_at := now();
  if new.work_date is not null and new.work_date > app.perth_today() then
    raise exception 'A day of work cannot be in the future.' using errcode = 'check_violation';
  end if;
  select p.org_id into v_org from public.projects p where p.id = v_reg.project_id;
  if new.plant_id is not null and not exists (select 1 from public.plant_register pr where pr.id = new.plant_id and pr.org_id = v_org) then
    raise exception 'That machine is not on this company''s plant register.' using errcode = 'check_violation';
  end if;
  if new.rate_item_id is not null and not exists (
       select 1 from public.rate_items r where r.id = new.rate_item_id and r.org_id = v_org and (r.project_id is null or r.project_id = v_reg.project_id)) then
    raise exception 'That rate is not on this job''s rate card.' using errcode = 'check_violation';
  end if;
  if new.source_entry_id is not null and not exists (select 1 from public.entries e where e.id = new.source_entry_id and e.project_id = v_reg.project_id) then
    raise exception 'That diary day is not on this job.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger variation_cost_lines_guard before insert or update or delete on public.variation_cost_lines
  for each row execute function app.variation_cost_lines_guard();

-- The build-up is the estimate. Security definer: the register takes writes only from definer code.
create or replace function app.variation_cost_lines_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_register uuid := case when tg_op = 'DELETE' then old.register_id else new.register_id end;
  v_lines integer;
  v_total numeric(14,2);
begin
  select count(*), sum(l.amount) into v_lines, v_total from public.variation_cost_lines l where l.register_id = v_register;
  update public.variation_register r
     set estimated_cost = case when v_lines > 0 then v_total else null end,
         estimate_source = case when v_lines > 0 then 'build_up' else 'manual' end
   where r.id = v_register
     and (v_lines > 0 or r.estimate_source = 'build_up');
  return null;
end;
$$;
create trigger variation_cost_lines_sync after insert or update or delete on public.variation_cost_lines
  for each row execute function app.variation_cost_lines_sync();

alter table public.variation_cost_lines enable row level security;
create policy variation_cost_lines_select on public.variation_cost_lines for select to authenticated using (app.can_manage_registers(project_id));
create policy variation_cost_lines_insert on public.variation_cost_lines for insert to authenticated with check (app.can_manage_registers(project_id));
create policy variation_cost_lines_update on public.variation_cost_lines for update to authenticated
  using (app.can_manage_registers(project_id)) with check (app.can_manage_registers(project_id));
create policy variation_cost_lines_delete on public.variation_cost_lines for delete to authenticated using (app.can_manage_registers(project_id));
create policy variation_cost_lines_reads_record on public.variation_cost_lines as restrictive for select to authenticated using (app.reads_record(project_id));
grant select, insert, update, delete on public.variation_cost_lines to authenticated;
grant all on public.variation_cost_lines to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. The typed estimate cannot overwrite a build-up. Same signature as 20260924120000; one line differs.

create or replace function public.set_variation_details(
  p_register_id uuid, p_vr_ref text, p_agreed_cost numeric, p_notes text,
  p_estimated_cost numeric default null, p_keep_estimate boolean default true)
returns public.variation_register language plpgsql security definer set search_path = '' as $$
declare v_row public.variation_register;
begin
  select * into v_row from public.variation_register where id = p_register_id;
  if not found then raise exception 'No such variation on the register.' using errcode = 'no_data_found'; end if;
  if not app.can_manage_registers(v_row.project_id) then
    raise exception 'Only someone who keeps the registers can price a variation.' using errcode = 'insufficient_privilege';
  end if;
  if p_agreed_cost is not null and p_agreed_cost < 0 then raise exception 'An agreed value cannot be negative.' using errcode = 'check_violation'; end if;
  if p_estimated_cost is not null and p_estimated_cost < 0 then raise exception 'An estimated value cannot be negative.' using errcode = 'check_violation'; end if;
  update public.variation_register r
     set vr_ref = nullif(btrim(coalesce(p_vr_ref, '')), ''),
         agreed_cost = p_agreed_cost,
         notes = nullif(btrim(coalesce(p_notes, '')), ''),
         -- A variation with a build-up is estimated by its lines (README R104).
         estimated_cost = case when p_keep_estimate or r.estimate_source = 'build_up' then r.estimated_cost else p_estimated_cost end
   where r.id = p_register_id
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.set_variation_details(uuid, text, numeric, text, numeric, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. What was claimed, as it stood when it was sent.

alter table public.variation_status_events
  add column claimed_total numeric(14,2),
  add column claimed_lines integer;

create or replace function app.variation_event_claimed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status::text = 'submitted' then
    select r.estimated_cost, (select count(*) from public.variation_cost_lines l where l.register_id = r.id)
      into new.claimed_total, new.claimed_lines
      from public.variation_register r where r.id = new.register_id;
  end if;
  return new;
end;
$$;
create trigger variation_event_claimed before insert on public.variation_status_events
  for each row execute function app.variation_event_claimed();
