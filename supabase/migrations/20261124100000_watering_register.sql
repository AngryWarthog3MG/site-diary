-- The watering register (README R190): on a landscape job, which area was watered on which day, how — irrigation, by
-- hand, or soaker hoses — and for how many hours, with any SUPPLEMENTARY watering beside it (the head contractor asks
-- for it on top of the irrigation, so both can sit on the one day), a note, and the day's maximum temperature.
--
-- Mitchell: "i need to add a watering register to the curtin page ... areas ... Monday - Sunday, the dropdowns need to
-- be Irrigation, Manual water, Soaker hoses, then the amount of hours its been running for, add a max daily
-- temperature also ... add notes also ... there could be irrigation and supplementary watering on the same day."
--
-- The shape:
--   watering_areas    the job's own list of areas; the office adds, renames, retires; never deleted.
--   watering_days     one row per job per day SOMEBODY RECORDED: the day's maximum temperature (typed, never taken from
--                     the Bureau by the app), and the fact that the day was recorded at all — so an empty area on a
--                     recorded day reads "not watered" and an unrecorded day reads "not recorded" (nil is not a gap).
--   watering_entries  one row per area per day: method + hours, supplementary method + hours, notes. A method may be
--                     kept without its hours (unstated is null and the register asks); hours never without a method.
--   watering_weeks    a row closes a Monday-to-Sunday week: once it is over, with no hours outstanding; then nothing
--                     in it changes. Until then a day is corrected freely — the last hand is stamped on the row.
-- Nothing is deleted. A job has a watering register once it has an area; no other job sees the section.

create table public.watering_areas (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null check (length(name) between 1 and 80),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);
comment on table public.watering_areas is
  'The areas of a job that are watered — the rows of its watering register. The office keeps the list; retired, never deleted. README R190.';
create unique index watering_areas_name_once on public.watering_areas (project_id, lower(name));

create table public.watering_days (
  project_id   uuid not null references public.projects (id) on delete cascade,
  day          date not null,
  temp_max     numeric(4,1) check (temp_max is null or (temp_max >= -10 and temp_max <= 60)),
  recorded_by  uuid references auth.users (id),
  recorded_at  timestamptz not null default now(),
  updated_by   uuid references auth.users (id),
  updated_at   timestamptz not null default now(),
  primary key (project_id, day)
);
comment on table public.watering_days is
  'A day of the watering register that somebody recorded, with the maximum temperature read on site. No row = the day was not recorded. README R190.';

create table public.watering_entries (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  area_id      uuid not null references public.watering_areas (id),
  day          date not null,
  method       text check (method in ('irrigation', 'manual', 'soaker')),
  hours        numeric(4,2) check (hours is null or (hours > 0 and hours <= 24)),
  supp_method  text check (supp_method in ('irrigation', 'manual', 'soaker')),
  supp_hours   numeric(4,2) check (supp_hours is null or (supp_hours > 0 and supp_hours <= 24)),
  notes        text check (notes is null or length(notes) <= 1000),
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id),
  updated_at   timestamptz not null default now(),
  constraint watering_entries_once unique (area_id, day),
  constraint watering_entries_hours_need_method check (hours is null or method is not null),
  constraint watering_entries_supp_hours_need_method check (supp_hours is null or supp_method is not null)
);
comment on table public.watering_entries is
  'One area on one day of the watering register: how it was watered and for how many hours, any supplementary watering beside it, and a note. README R190.';
create index watering_entries_project_day_idx on public.watering_entries (project_id, day);

create table public.watering_weeks (
  project_id  uuid not null references public.projects (id) on delete cascade,
  week_start  date not null check (extract(isodow from week_start) = 1),
  closed_by   uuid references auth.users (id),
  closed_at   timestamptz not null default now(),
  primary key (project_id, week_start)
);
comment on table public.watering_weeks is
  'A closed week of the watering register (its Monday). A row here freezes that week''s days and entries. README R190.';

-- ---------------------------------------------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------------------------------------------

create or replace function app.watering_areas_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.name := regexp_replace(btrim(coalesce(new.name, '')), '\s+', ' ', 'g');
  if length(new.name) = 0 then raise exception 'An area needs a name.' using errcode = 'check_violation'; end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
  else
    if new.project_id <> old.project_id then raise exception 'An area stays on its job.' using errcode = 'check_violation'; end if;
    new.created_by := old.created_by; new.created_at := old.created_at;
  end if;
  return new;
end; $$;
create trigger watering_areas_before_write before insert or update on public.watering_areas
  for each row execute function app.watering_areas_before_write();
create trigger a_watering_areas_no_delete before delete on public.watering_areas
  for each row execute function app.frozen_row();

-- A day takes watering once it has come, and until its week is closed.
create or replace function app.watering_day_open(p_project uuid, p_day date)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_day > app.perth_today() then
    raise exception 'Watering is recorded for a day that has come, not one ahead.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.watering_weeks w
              where w.project_id = p_project and w.week_start = p_day - (extract(isodow from p_day)::integer - 1)) then
    raise exception 'That week of the watering register is closed; nothing in it changes.' using errcode = 'check_violation';
  end if;
end; $$;

create or replace function app.watering_days_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform app.watering_day_open(new.project_id, new.day);
    new.recorded_by := (select auth.uid()); new.recorded_at := now();
    new.updated_by := new.recorded_by; new.updated_at := now();
  else
    if new.project_id <> old.project_id or new.day <> old.day then
      raise exception 'A recorded day stays on its job and its date.' using errcode = 'check_violation';
    end if;
    new.recorded_by := old.recorded_by; new.recorded_at := old.recorded_at;
    if new.temp_max is not distinct from old.temp_max then
      new.updated_by := old.updated_by; new.updated_at := old.updated_at;
    else
      perform app.watering_day_open(new.project_id, new.day);
      new.updated_by := (select auth.uid()); new.updated_at := now();
    end if;
  end if;
  return new;
end; $$;
create trigger watering_days_before_write before insert or update on public.watering_days
  for each row execute function app.watering_days_before_write();
create trigger a_watering_days_no_delete before delete on public.watering_days
  for each row execute function app.frozen_row();

create or replace function app.watering_entries_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  new.notes := nullif(regexp_replace(btrim(coalesce(new.notes, '')), '\s+', ' ', 'g'), '');
  if tg_op = 'INSERT' then
    perform app.watering_day_open(new.project_id, new.day);
    select project_id, active into a from public.watering_areas where id = new.area_id;
    if a.project_id is null or a.project_id <> new.project_id then
      raise exception 'The area must be one of this job''s.' using errcode = 'check_violation';
    end if;
    if not a.active and not exists (select 1 from public.watering_entries e where e.area_id = new.area_id and e.day = new.day) then
      raise exception 'That area is retired; restore it to record watering on it.' using errcode = 'check_violation';
    end if;
    new.created_by := (select auth.uid()); new.created_at := now();
    new.updated_by := new.created_by; new.updated_at := now();
  else
    if new.project_id <> old.project_id or new.area_id <> old.area_id or new.day <> old.day then
      raise exception 'A watering line stays on its area and its day.' using errcode = 'check_violation';
    end if;
    new.created_by := old.created_by; new.created_at := old.created_at;
    if new.method is not distinct from old.method and new.hours is not distinct from old.hours
       and new.supp_method is not distinct from old.supp_method and new.supp_hours is not distinct from old.supp_hours
       and new.notes is not distinct from old.notes then
      -- A save of the whole day rewrites every line; one that says what was already there is not a change.
      new.updated_by := old.updated_by; new.updated_at := old.updated_at;
    else
      perform app.watering_day_open(new.project_id, new.day);
      new.updated_by := (select auth.uid()); new.updated_at := now();
    end if;
  end if;
  return new;
end; $$;
create trigger watering_entries_before_write before insert or update on public.watering_entries
  for each row execute function app.watering_entries_before_write();
create trigger a_watering_entries_no_delete before delete on public.watering_entries
  for each row execute function app.frozen_row();

-- Closing a week: once it is over, and only with every line's hours in. Then it is never reopened or removed.
create or replace function app.watering_weeks_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if new.week_start + 6 >= app.perth_today() then
    raise exception 'A week is closed once it is over — after its Sunday.' using errcode = 'check_violation';
  end if;
  select count(*) into n from public.watering_entries e
   where e.project_id = new.project_id and e.day between new.week_start and new.week_start + 6
     and ((e.method is not null and e.hours is null) or (e.supp_method is not null and e.supp_hours is null));
  if n > 0 then
    raise exception '% watering line(s) in that week still need their hours.', n using errcode = 'check_violation';
  end if;
  new.closed_by := (select auth.uid()); new.closed_at := now();
  return new;
end; $$;
create trigger watering_weeks_before_insert before insert on public.watering_weeks
  for each row execute function app.watering_weeks_before_insert();
create trigger a_watering_weeks_frozen before update or delete on public.watering_weeks
  for each row execute function app.frozen_row();

-- ---------------------------------------------------------------------------------------------------------------
-- Who: read by the job's members who read the record (never the labourer); watering recorded by whoever runs the
-- site (leading hand, supervisor, PM, admin); the area list kept by the office; a week closed by a supervisor, PM
-- or admin.
-- ---------------------------------------------------------------------------------------------------------------

alter table public.watering_areas enable row level security;
alter table public.watering_days enable row level security;
alter table public.watering_entries enable row level security;
alter table public.watering_weeks enable row level security;

create policy watering_areas_select on public.watering_areas for select to authenticated
  using (app.is_project_member(project_id) and app.reads_record(project_id));
create policy watering_areas_insert on public.watering_areas for insert to authenticated with check (app.is_office(project_id));
create policy watering_areas_update on public.watering_areas for update to authenticated
  using (app.is_office(project_id)) with check (app.is_office(project_id));

create policy watering_days_select on public.watering_days for select to authenticated
  using (app.is_project_member(project_id) and app.reads_record(project_id));
create policy watering_days_insert on public.watering_days for insert to authenticated with check (app.can_run_talks(project_id));
create policy watering_days_update on public.watering_days for update to authenticated
  using (app.can_run_talks(project_id)) with check (app.can_run_talks(project_id));

create policy watering_entries_select on public.watering_entries for select to authenticated
  using (app.is_project_member(project_id) and app.reads_record(project_id));
create policy watering_entries_insert on public.watering_entries for insert to authenticated with check (app.can_run_talks(project_id));
create policy watering_entries_update on public.watering_entries for update to authenticated
  using (app.can_run_talks(project_id)) with check (app.can_run_talks(project_id));

create policy watering_weeks_select on public.watering_weeks for select to authenticated
  using (app.is_project_member(project_id) and app.reads_record(project_id));
create policy watering_weeks_insert on public.watering_weeks for insert to authenticated with check (app.can_manage_incidents(project_id));

grant select, insert, update on public.watering_areas, public.watering_days, public.watering_entries to authenticated;
grant select, insert on public.watering_weeks to authenticated;
grant all on public.watering_areas, public.watering_days, public.watering_entries, public.watering_weeks to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Curtin's areas, as Mitchell gave them (24/11/2026). Scoped to that one job by id; a database without it gets none.
-- ---------------------------------------------------------------------------------------------------------------
insert into public.watering_areas (project_id, name, sort_order)
select p.id, v.name, v.ord
  from public.projects p
  cross join (values
    ('Old Brand Drive North', 1), ('Old Brand Drive South', 2), ('East Gate', 3),
    ('Brand Drive', 4), ('Bus Port', 5), ('Holding Stock Area', 6)
  ) as v(name, ord)
 where p.id = 'b44c4faf-3cd6-408a-8a11-a6246f9cb725'
on conflict do nothing;
