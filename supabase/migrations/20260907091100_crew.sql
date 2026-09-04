-- ============================================================================
-- 20260907091100_crew.sql
-- The crew list: who works this job, and what they do.
--
-- Labour was typed name by name, role by role, every day — or picked off
-- chips harvested from past entries, with no role attached. A project now
-- keeps its own list, kept up by the supervisor in Settings, and the entry
-- screen offers it as a dropdown. The list is a convenience for filling the
-- day in; the record stays what the supervisor confirmed and signed.
-- ============================================================================

create table public.crew (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  role        text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (project_id, name)
);

create index crew_project_idx on public.crew (project_id, active, sort_order, name);

alter table public.crew enable row level security;

create policy crew_select_member on public.crew
  for select to authenticated using (app.is_project_member(project_id));

-- The people who fill the diary in keep the list.
create policy crew_write_supervisor on public.crew
  for all to authenticated
  using (app.can_run_talks(project_id))
  with check (app.can_run_talks(project_id));

grant select, insert, update, delete on public.crew to authenticated;
grant all on public.crew to service_role;

-- Curtin's crew, as given by the owner on 2026-09-04.
insert into public.crew (project_id, name, role, sort_order)
select p.id, v.name, v.role, v.ord
from public.projects p
join (values
  ('Marcus Hayden',   'Labourer',   1),
  ('Hamish Hayden',   'Labourer',   2),
  ('Evan Burke',      'Machine Op', 3),
  ('Matthew Rodgers', 'Supervisor', 4),
  ('AJ',              'Landscaper', 5)
) as v(name, role, ord) on true
where p.code = 'C001'
on conflict (project_id, name) do nothing;
