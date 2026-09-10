-- ============================================================================
-- One plant register.
--
-- Two lists said "plant" — the per-job plant_list the diary's vocabulary
-- came from, and the company-wide plant_register the checklist picks from —
-- and the same three machines had to be kept in both. Now there is the
-- register, which is the fleet, and project_plant, which says which of the
-- fleet is on which job. The diary's vocabulary, the review chips and the
-- Plant page's "today" list all read project_plant → plant_register.
--
-- The list's rows move across faithfully: what a supervisor typed for
-- ownership, supplier and the names a machine answers to beats the guess the
-- register was seeded with.
-- ============================================================================

alter table public.plant_register add column if not exists aliases text[] not null default '{}';

create table public.project_plant (
  project_id  uuid not null references public.projects (id) on delete cascade,
  plant_id    uuid not null references public.plant_register (id) on delete restrict,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  primary key (project_id, plant_id)
);
create index project_plant_project_idx on public.project_plant (project_id, active, sort_order);

alter table public.project_plant enable row level security;
create policy project_plant_select_member on public.project_plant
  for select to authenticated using (app.is_project_member(project_id));
create policy project_plant_write_crew on public.project_plant
  for all to authenticated
  using (app.can_run_talks(project_id))
  with check (app.can_run_talks(project_id));
grant select, insert, update, delete on public.project_plant to authenticated;
grant all on public.project_plant to service_role;

-- Move the per-job list into the fleet.
do $$
declare
  l record;
  v_org uuid;
  v_plant uuid;
  v_ownership text;
begin
  for l in select pl.*, p.org_id from public.plant_list pl join public.projects p on p.id = pl.project_id loop
    v_org := l.org_id;
    v_ownership := case l.hire_type when 'wet' then 'wet_hire' when 'dry' then 'dry_hire' else 'own' end;
    select r.id into v_plant
      from public.plant_register r
     where r.org_id = v_org and lower(r.name) = lower(l.item)
     order by r.active desc, r.created_at
     limit 1;
    if v_plant is null then
      insert into public.plant_register (org_id, name, kind, ownership, supplier, aliases, active)
      values (v_org, l.item,
              case when l.item ilike '%excavator%' then 'excavator'
                   when l.item ilike '%vac%trailer%' then 'vac_trailer'
                   when l.item ilike '%vac%' then 'vac_truck'
                   when l.item ilike '%roller%' then 'roller'
                   else 'other' end,
              v_ownership, l.supplier, coalesce(l.aliases, '{}'), l.active)
      returning id into v_plant;
    else
      update public.plant_register r
         set ownership = v_ownership,
             supplier  = coalesce(l.supplier, r.supplier),
             aliases   = case when cardinality(r.aliases) = 0 then coalesce(l.aliases, '{}') else r.aliases end
       where r.id = v_plant;
    end if;
    insert into public.project_plant (project_id, plant_id, active, sort_order)
    values (l.project_id, v_plant, l.active, l.sort_order)
    on conflict (project_id, plant_id) do update set active = excluded.active, sort_order = excluded.sort_order;
  end loop;
end;
$$;

drop table public.plant_list;
