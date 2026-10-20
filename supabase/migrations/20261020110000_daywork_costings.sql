-- Costing allocations for dayworks (README R159).
--
-- Mitchell: "If people are not selected, allow me to select them from a dropdown so we capture all hours correctly.
-- Do the same for plant — I need to add costs for plant used too."
--
-- A signed day never changes (non-negotiable 2), and twenty-one of Curtin's dayworks were signed with their labour as
-- words alone — "2x Marcus Hayden, Evan Burke" — and every one of them names its plant as words: "Vac Trailer, 1.8t
-- Excavator". Neither can be priced by person or by machine. So the office keeps, BESIDE the day, what the claim is
-- costed from: for each daywork, the people (only where the signed row names nobody — where it does, the record wins)
-- and the machines, each with their hours. It is a costing allocation, not the record: never in the hash, never on
-- the docket, never on the sheet the head contractor signs, and the schedule says it is the office's figure. Register
-- keepers write it; every change is kept.

create table public.daywork_costings (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  daywork_id  uuid not null unique references public.dayworks (id) on delete cascade,
  -- [{ "person_name": "Marcus Hayden", "hours": 10 }, …] — only where the signed row has no labour_rows.
  labour      jsonb not null default '[]'::jsonb check (jsonb_typeof(labour) = 'array'),
  -- [{ "plant_id": uuid | null, "name": "1.8t Excavator", "hours": 10 }, …]
  plant       jsonb not null default '[]'::jsonb check (jsonb_typeof(plant) = 'array'),
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
comment on table public.daywork_costings is
  'What the office costs a signed daywork from, beside the record (README R159): the people where the row names nobody, and the machines, each with hours. Never the record itself.';
create index daywork_costings_project on public.daywork_costings (project_id);

create table public.daywork_costing_changes (
  id          uuid primary key default gen_random_uuid(),
  costing_id  uuid not null references public.daywork_costings (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  old_labour  jsonb,
  new_labour  jsonb,
  old_plant   jsonb,
  new_plant   jsonb,
  changed_by  uuid default auth.uid(),
  changed_at  timestamptz not null default now()
);
create index daywork_costing_changes_item on public.daywork_costing_changes (costing_id);

-- Tidy and check one allocation list: names non-empty and single-spaced, hours null or 0..24, a machine's plant_id
-- on the company's register when given.
create or replace function app.daywork_costing_tidy(p_rows jsonb, p_kind text, p_org uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  r      jsonb;
  out    jsonb := '[]'::jsonb;
  v_name text;
  v_hrs  numeric;
  v_pid  uuid;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if jsonb_typeof(r) <> 'object' then
      raise exception 'Each % line is a name and hours.', p_kind using errcode = 'check_violation';
    end if;
    v_name := btrim(regexp_replace(coalesce(r->>(case when p_kind = 'labour' then 'person_name' else 'name' end), ''), '\s+', ' ', 'g'));
    if v_name = '' then
      raise exception 'A % line needs a name.', p_kind using errcode = 'check_violation';
    end if;
    if nullif(r->>'hours', '') is null then
      v_hrs := null;
    else
      begin
        v_hrs := (r->>'hours')::numeric;
      exception when others then
        raise exception 'Hours for % are a number.', v_name using errcode = 'check_violation';
      end;
      if v_hrs < 0 or v_hrs > 24 then
        raise exception 'Hours for % are between 0 and 24.', v_name using errcode = 'check_violation';
      end if;
      v_hrs := round(v_hrs, 2);
    end if;
    if p_kind = 'labour' then
      out := out || jsonb_build_object('person_name', v_name, 'hours', v_hrs);
    else
      v_pid := null;
      if nullif(r->>'plant_id', '') is not null then
        begin
          v_pid := (r->>'plant_id')::uuid;
        exception when others then
          raise exception 'The machine for % is not on the register.', v_name using errcode = 'check_violation';
        end;
        if not exists (select 1 from public.plant_register pr where pr.id = v_pid and pr.org_id = p_org) then
          raise exception 'The machine for % is not on the company''s register.', v_name using errcode = 'check_violation';
        end if;
      end if;
      out := out || jsonb_build_object('plant_id', v_pid, 'name', v_name, 'hours', v_hrs);
    end if;
  end loop;
  return out;
end;
$$;

create or replace function app.daywork_costings_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_entry_project uuid;
  v_status        text;
  v_org           uuid;
  v_rows          jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id or new.daywork_id <> old.daywork_id then
      raise exception 'A costing stays with its daywork.' using errcode = 'check_violation';
    end if;
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  select e.project_id, e.status::text, dw.labour_rows into v_entry_project, v_status, v_rows
    from public.dayworks dw join public.entries e on e.id = dw.entry_id
   where dw.id = new.daywork_id;
  if not found or v_entry_project <> new.project_id then
    raise exception 'That daywork is not on this job.' using errcode = 'check_violation';
  end if;
  if v_status <> 'signed' then
    raise exception 'A daywork is costed once its day is signed.' using errcode = 'check_violation';
  end if;
  select p.org_id into v_org from public.projects p where p.id = new.project_id;
  new.labour := app.daywork_costing_tidy(new.labour, 'labour', v_org);
  new.plant := app.daywork_costing_tidy(new.plant, 'plant', v_org);
  -- The signed row names its people: the record wins, and the office does not keep a second list.
  if jsonb_array_length(new.labour) > 0 and v_rows is not null and jsonb_typeof(v_rows) = 'array' and jsonb_array_length(v_rows) > 0 then
    raise exception 'The signed day already names its people and their hours; only the plant is costed from here.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger daywork_costings_before_write before insert or update on public.daywork_costings
  for each row execute function app.daywork_costings_before_write();

create or replace function app.daywork_costings_log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.labour is distinct from old.labour or new.plant is distinct from old.plant then
    insert into public.daywork_costing_changes (costing_id, project_id, old_labour, new_labour, old_plant, new_plant, changed_by)
    values (new.id, new.project_id, old.labour, new.labour, old.plant, new.plant, auth.uid());
  end if;
  return new;
end;
$$;
create trigger daywork_costings_log_change after update on public.daywork_costings
  for each row execute function app.daywork_costings_log_change();

-- Register keepers (supervisor/pm/admin) read and write; the labourer reads none; never deleted.
alter table public.daywork_costings enable row level security;
alter table public.daywork_costing_changes enable row level security;
create policy daywork_costings_select on public.daywork_costings for select to authenticated
  using (app.can_manage_registers(project_id));
create policy daywork_costings_insert on public.daywork_costings for insert to authenticated
  with check (app.can_manage_registers(project_id));
create policy daywork_costings_update on public.daywork_costings for update to authenticated
  using (app.can_manage_registers(project_id)) with check (app.can_manage_registers(project_id));
create policy daywork_costings_reads_record on public.daywork_costings as restrictive for select to authenticated
  using (app.reads_record(project_id));
create policy daywork_costing_changes_select on public.daywork_costing_changes for select to authenticated
  using (app.can_manage_registers(project_id));
create policy daywork_costing_changes_reads_record on public.daywork_costing_changes as restrictive for select to authenticated
  using (app.reads_record(project_id));
grant select, insert, update on public.daywork_costings to authenticated;
grant select on public.daywork_costing_changes to authenticated;
grant all on public.daywork_costings, public.daywork_costing_changes to service_role;
