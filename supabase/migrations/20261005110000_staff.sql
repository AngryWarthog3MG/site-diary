-- The company's staff list (README R123). "Under the staff tab, add a tab that has all ops that work for Kooboolong
-- with all their inductions, their roles, certificates — all in one place. From here I'd assign ops to certain jobs
-- that will then be used in the daily diary."
--
-- Until now a person existed only where something was recorded about them: a row on one job's crew list, a ticket, an
-- induction — each by name, none of them the person. So there was no list of who works for the company, a role had to
-- be typed again on every job, and somebody not yet on a job was nobody. This table is that list: one row per person
-- per company, by the name that goes on the sheets. Everything else still hangs off the name, as it always has —
-- `crew` (which job they are on, and what the diary offers), `crew_tickets` (what they hold), `crew_inductions`
-- (where they are inducted) — so nothing already recorded moves.
--
-- Two rules keep it the one list rather than a second one:
--   1. Anyone put on a job's crew list, or given a ticket, is on the staff list — the database adds them.
--   2. The role set here flows to the person's crew rows (where a job has not given them a different one), and a
--      person marked as no longer with the company comes off every job's crew list. A day already recorded never changes.

create table public.staff (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations (id),
  name        text not null check (btrim(name) <> ''),
  role        text,
  phone       text,
  -- Who employs them when it is not the company itself: a labour-hire firm, a subcontractor. Null = the company's own.
  employer    text,
  notes       text,
  active      boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index staff_one_per_name on public.staff (org_id, lower(name));

create or replace function app.staff_tidy()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.role := nullif(btrim(regexp_replace(coalesce(new.role, ''), '\s+', ' ', 'g')), '');
  new.phone := nullif(btrim(regexp_replace(coalesce(new.phone, ''), '\s+', ' ', 'g')), '');
  new.employer := nullif(btrim(regexp_replace(coalesce(new.employer, ''), '\s+', ' ', 'g')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id then
      raise exception 'A person does not move between companies.' using errcode = 'check_violation';
    end if;
    -- The name is what the crew lists, tickets, inductions and signed diaries know the person by.
    if lower(new.name) <> lower(old.name) then
      raise exception 'A name on the staff list is not changed: the tickets, inductions and diaries are filed under it. Add the right name and mark this one as no longer with the company.'
        using errcode = 'check_violation';
    end if;
    new.created_by := old.created_by; new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger staff_tidy before insert or update on public.staff
  for each row execute function app.staff_tidy();

-- What is set here reaches the jobs.
create or replace function app.staff_flows_to_crews()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role then
    update public.crew c set role = new.role
      from public.projects p
     where p.id = c.project_id and p.org_id = new.org_id
       and lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = lower(new.name)
       and (c.role is null or btrim(c.role) = '' or lower(btrim(c.role)) = lower(coalesce(old.role, '')));
  end if;
  if old.active and not new.active then
    update public.crew c set active = false
      from public.projects p
     where p.id = c.project_id and p.org_id = new.org_id and c.active
       and lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = lower(new.name);
  end if;
  return null;
end;
$$;
create trigger staff_flows_to_crews after update on public.staff
  for each row execute function app.staff_flows_to_crews();

-- Anyone put on a crew list, or given a ticket, is on the staff list.
create or replace function app.crew_joins_staff()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.staff (org_id, name, role, created_by)
  select p.org_id, new.name, new.role, (select auth.uid()) from public.projects p where p.id = new.project_id
  on conflict (org_id, lower(name)) do nothing;
  return null;
end;
$$;
create trigger crew_joins_staff after insert on public.crew
  for each row execute function app.crew_joins_staff();

create or replace function app.ticket_holder_joins_staff()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.staff (org_id, name, created_by)
  values (new.org_id, new.person_name, (select auth.uid()))
  on conflict (org_id, lower(name)) do nothing;
  return null;
end;
$$;
create trigger ticket_holder_joins_staff after insert on public.crew_tickets
  for each row execute function app.ticket_holder_joins_staff();

-- Everyone who reads the company's record reads the list (a labourer does not: it carries phone numbers). The people
-- who keep tickets keep the list. Nobody deletes: someone who has left is marked so, and the record keeps their name.
alter table public.staff enable row level security;
create policy staff_select on public.staff for select to authenticated using (app.reads_org_record(org_id));
create policy staff_insert on public.staff for insert to authenticated with check (app.can_manage_crew(org_id));
create policy staff_update on public.staff for update to authenticated
  using (app.can_manage_crew(org_id)) with check (app.can_manage_crew(org_id));
revoke all on public.staff from anon, authenticated;
grant select, insert, update on public.staff to authenticated;
grant all on public.staff to service_role;

-- The list as it stands today: everyone on a crew list (the role from their most recent active row), then anyone who
-- holds a ticket and is on none. Nothing existing is changed.
insert into public.staff (org_id, name, role, created_by)
select distinct on (p.org_id, lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')))
       p.org_id, c.name, c.role, null
  from public.crew c join public.projects p on p.id = c.project_id
 order by p.org_id, lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')), c.active desc, (c.role is not null) desc, c.created_at desc
on conflict (org_id, lower(name)) do nothing;

insert into public.staff (org_id, name, created_by)
select distinct on (t.org_id, lower(regexp_replace(btrim(t.person_name), '\s+', ' ', 'g')))
       t.org_id, t.person_name, null
  from public.crew_tickets t
 where t.active
 order by t.org_id, lower(regexp_replace(btrim(t.person_name), '\s+', ' ', 'g')), t.created_at desc
on conflict (org_id, lower(name)) do nothing;
