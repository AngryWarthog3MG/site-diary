-- ============================================================================
-- 20260907091200_plant_list.sql
-- The plant list: what is on this job, so a normal day is picked not typed.
-- Same shape and rules as the crew list (20260907091100).
-- ============================================================================

create table public.plant_list (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  item        text not null check (length(btrim(item)) > 0),
  hire_type   text,
  supplier    text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (project_id, item)
);

create index plant_list_project_idx on public.plant_list (project_id, active, sort_order, item);

alter table public.plant_list enable row level security;

create policy plant_list_select_member on public.plant_list
  for select to authenticated using (app.is_project_member(project_id));

create policy plant_list_write_supervisor on public.plant_list
  for all to authenticated
  using (app.can_run_talks(project_id))
  with check (app.can_run_talks(project_id));

grant select, insert, update, delete on public.plant_list to authenticated;
grant all on public.plant_list to service_role;

-- Curtin's plant, as given by the owner on 2026-09-04.
insert into public.plant_list (project_id, item, sort_order)
select p.id, v.item, v.ord
from public.projects p
join (values ('Vac Truck', 1), ('Vac Trailer', 2), ('1.8t Excavator', 3)) as v(item, ord) on true
where p.code = 'C001'
on conflict (project_id, item) do nothing;
