-- ============================================================================
-- Plant prestarts.
--
-- Before a machine starts for the day the operator walks around it and checks
-- it. WA's WHS regulations expect that inspection to happen and to be
-- recorded; until now the crew prestart carried one tick — "plant pre-start
-- checks done and logged" — with nothing behind it.
--
-- Two tables and a defect log:
--   * plant_register  — the company's plant, one row per machine, shared by
--                       every job in the organisation. A searchable list the
--                       checklist picks from; anyone who runs prestarts can
--                       add to it, so an unfamiliar hire machine is one tap
--                       away rather than a phone call to the office.
--   * plant_prestarts — one inspection: the machine, the day, the operator,
--                       the hour meter, every check with its result and the
--                       label it carried at the time, whether the machine is
--                       fit for use, and the operator's signature. Signing
--                       freezes it (database-enforced), same as the crew
--                       prestart.
--   * plant_defects   — anything marked Defect, raised from the inspection
--                       and open until someone closes it with a note.
--
-- The per-job `plant_list` stays what it is: the diary's vocabulary for what
-- worked today. The register is the fleet; the list is the job.
-- ============================================================================

create table public.plant_register (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations (id) on delete restrict,
  name        text not null check (length(btrim(name)) > 0),
  -- Which checklist applies: excavator, vac_truck, vac_trailer, truck,
  -- roller, small_plant, other. Fixed in the app; the record keeps the text.
  kind        text not null default 'other',
  make_model  text,
  plant_no    text,
  ownership   text not null default 'own' check (ownership in ('own', 'dry_hire', 'wet_hire')),
  supplier    text,
  notes       text,
  active      boolean not null default true,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);
create unique index plant_register_unique_idx
  on public.plant_register (org_id, lower(name), coalesce(lower(plant_no), ''));
create index plant_register_org_idx on public.plant_register (org_id, active, name);

create table public.plant_prestarts (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete restrict,
  plant_id       uuid not null references public.plant_register (id) on delete restrict,
  prestart_date  date not null,
  operator_name  text not null check (length(btrim(operator_name)) > 0),
  hour_meter     numeric(9,1) check (hour_meter >= 0),
  -- [{key, label, result}] with result in ok | defect | na. Labels are kept
  -- as they read on the day, so a later wording change cannot rewrite what
  -- was ticked.
  checks         jsonb not null default '[]'::jsonb,
  fit_for_use    boolean not null default true,
  notes          text,
  signature_path text,
  conducted_by   uuid not null references auth.users (id),
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index plant_prestarts_project_idx on public.plant_prestarts (project_id, prestart_date desc);
create index plant_prestarts_plant_idx on public.plant_prestarts (plant_id, prestart_date desc);

create table public.plant_defects (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete restrict,
  plant_id     uuid not null references public.plant_register (id) on delete restrict,
  prestart_id  uuid references public.plant_prestarts (id) on delete set null,
  item_key     text not null,
  item_label   text not null,
  note         text,
  photo_path   text,
  raised_by    uuid not null references auth.users (id),
  raised_at    timestamptz not null default now(),
  closed_at    timestamptz,
  closed_by    uuid references auth.users (id),
  closed_note  text
);
create index plant_defects_open_idx on public.plant_defects (project_id, closed_at, raised_at desc);
create index plant_defects_plant_idx on public.plant_defects (plant_id, closed_at);

-- ----------------------------------------------------------------------------
-- Who may do what. The people who run prestarts run plant prestarts and keep
-- the register; everyone on a job in the organisation can read.
-- ----------------------------------------------------------------------------
create or replace function app.can_manage_plant(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.project_members pm
      join public.projects p on p.id = pm.project_id
     where p.org_id = p_org_id
       and pm.user_id = auth.uid()
       and pm.role in ('supervisor', 'leading_hand', 'admin')
  );
$$;

create or replace function app.can_write_plant_prestart(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.plant_prestarts s
     where s.id = p_id
       and s.completed_at is null
       and app.can_run_talks(s.project_id)
  );
$$;

grant execute on function app.can_manage_plant(uuid), app.can_write_plant_prestart(uuid) to authenticated;

alter table public.plant_register enable row level security;
alter table public.plant_prestarts enable row level security;
alter table public.plant_defects enable row level security;

create policy plant_register_select_org on public.plant_register
  for select to authenticated using (app.is_org_member(org_id));
create policy plant_register_insert_crew on public.plant_register
  for insert to authenticated with check (app.can_manage_plant(org_id));
create policy plant_register_update_crew on public.plant_register
  for update to authenticated using (app.can_manage_plant(org_id)) with check (app.can_manage_plant(org_id));

create policy plant_prestarts_select_member on public.plant_prestarts
  for select to authenticated using (app.is_project_member(project_id));
create policy plant_prestarts_insert_crew on public.plant_prestarts
  for insert to authenticated
  with check (conducted_by = (select auth.uid()) and app.can_run_talks(project_id));
create policy plant_prestarts_update_open on public.plant_prestarts
  for update to authenticated
  using (completed_at is null and app.can_run_talks(project_id))
  with check (app.can_run_talks(project_id));
create policy plant_prestarts_delete_open on public.plant_prestarts
  for delete to authenticated
  using (completed_at is null and app.can_run_talks(project_id));

create policy plant_defects_select_member on public.plant_defects
  for select to authenticated using (app.is_project_member(project_id));
create policy plant_defects_insert_crew on public.plant_defects
  for insert to authenticated
  with check (raised_by = (select auth.uid()) and app.can_run_talks(project_id));
create policy plant_defects_update_crew on public.plant_defects
  for update to authenticated
  using (app.can_run_talks(project_id)) with check (app.can_run_talks(project_id));

-- ----------------------------------------------------------------------------
-- Signing freezes it. The operator's signature arriving is the moment of
-- completion, stamped by the database; from then on nothing changes.
-- ----------------------------------------------------------------------------
create or replace function app.plant_prestart_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.completed_at is not null then
      raise exception 'This plant prestart is signed and cannot be deleted.' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if old.completed_at is not null then
    raise exception 'This plant prestart is signed and cannot be modified.' using errcode = 'check_violation';
  end if;
  if new.signature_path is not null and old.signature_path is null then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

create trigger plant_prestarts_immutable
  before update or delete on public.plant_prestarts
  for each row execute function app.plant_prestart_before_update();

grant select, insert, update on public.plant_register to authenticated;
grant select, insert, update, delete on public.plant_prestarts to authenticated;
grant select, insert, update on public.plant_defects to authenticated;
grant all on public.plant_register, public.plant_prestarts, public.plant_defects to service_role;

-- Signatures and defect photos live under {project}/plant/{prestart}/… in entry-photos.
create policy "plant prestart images writable while open" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-photos'
    and (storage.foldername(name))[2] = 'plant'
    and app.can_write_plant_prestart(((storage.foldername(name))[3])::uuid)
  );

-- ----------------------------------------------------------------------------
-- The diary notices. A plant row on a day with no signed plant prestart for
-- that machine is a warning on review — a question, never a veto.
-- ----------------------------------------------------------------------------
create or replace function app.entry_warnings(p_entry_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(warning order by warning), '{}')
  from (
    select distinct 'weather_delay_without_rainfall' as warning
      from public.delays d
      join public.weather w on w.entry_id = d.entry_id
     where d.entry_id = p_entry_id
       and d.category = 'weather'
       and w.rainfall_mm is not null
       and w.rainfall_mm = 0
    union
    select distinct 'weather_delay_without_weather_record'
      from public.delays d
     where d.entry_id = p_entry_id
       and d.category = 'weather'
       and not exists (
         select 1 from public.weather w
          where w.entry_id = p_entry_id and w.rainfall_mm is not null
       )
    union
    select distinct 'weather_station_far_from_site'
      from public.weather w
     where w.entry_id = p_entry_id
       and w.station_distance_km is not null
       and w.station_distance_km > 25
    union
    select distinct 'plant_without_prestart'
      from public.plant pl
      join public.entries e on e.id = pl.entry_id
     where pl.entry_id = p_entry_id
       and not exists (
         select 1
           from public.plant_prestarts pp
           join public.plant_register pr on pr.id = pp.plant_id
          where pp.project_id = e.project_id
            and pp.prestart_date = e.entry_date
            and pp.completed_at is not null
            and (pr.name ilike '%' || pl.item || '%' or pl.item ilike '%' || pr.name || '%')
       )
  ) g;
$$;
