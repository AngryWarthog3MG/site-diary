-- Charge-out rates by person (README R158).
--
-- Mitchell: "take the information from the daywork sheet — the labour, the name — and each name will have an hourly
-- rate associated to that name. Evan Burke at $105 an hour, Matty Rogers at $140, Marcus Hayden at $105. When we pull
-- up the daywork sheet it automatically populates the hours and the total cost for each individual for that day."
--
-- The rate card (R104) prices labour by the ROLE worked. A daywork's labour rows (R129) name PEOPLE with their own
-- hours, and what the company charges is by the person. So this is a second, small list: one rate per person, by the
-- name on the sheets, company-wide, in dollars an hour ex GST. It is money: readable only by someone who sees the
-- money with their code entered (R105, R106); written by an admin, like the rate card (R136). Never deleted —
-- retired — and every change is kept. Nothing here is a copy of anything: the hours stay on the signed day, the
-- amount is hours × rate worked out on the way to the screen, never stored.

create table public.person_rates (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations (id) on delete cascade,
  person_name  text not null check (btrim(person_name) <> ''),
  rate         numeric(12,2) not null check (rate >= 0),
  unit         text not null default 'hour' check (unit = 'hour'),
  notes        text,
  active       boolean not null default true,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.person_rates is
  'What the company charges for a named person, per hour ex GST (README R158). One live rate per person per company; retired, never deleted.';
create unique index person_rates_one_live_name
  on public.person_rates (org_id, lower(person_name)) where active;
create index person_rates_org on public.person_rates (org_id);

create table public.person_rate_changes (
  id              uuid primary key default gen_random_uuid(),
  person_rate_id  uuid not null references public.person_rates (id) on delete cascade,
  org_id          uuid not null references public.organisations (id) on delete cascade,
  old_rate        numeric(12,2),
  new_rate        numeric(12,2),
  old_active      boolean,
  new_active      boolean,
  changed_by      uuid default auth.uid(),
  changed_at      timestamptz not null default now()
);
create index person_rate_changes_item on public.person_rate_changes (person_rate_id);

-- The name is tidied the way every other name on the sheets is, and the row stamps its own clock.
create or replace function app.person_rates_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.person_name := btrim(regexp_replace(coalesce(new.person_name, ''), '\s+', ' ', 'g'));
  if length(new.person_name) < 2 or new.person_name !~ '[[:alpha:]]' then
    raise exception 'Give the person their name, as it goes on the sheets.' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id then
      raise exception 'A rate stays with its company.' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger person_rates_before_write before insert or update on public.person_rates
  for each row execute function app.person_rates_before_write();

create or replace function app.person_rates_log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.rate is distinct from old.rate or new.active is distinct from old.active then
    insert into public.person_rate_changes (person_rate_id, org_id, old_rate, new_rate, old_active, new_active, changed_by)
    values (new.id, new.org_id, old.rate, new.rate, old.active, new.active, auth.uid());
  end if;
  return new;
end;
$$;
create trigger person_rates_log_change after update on public.person_rates
  for each row execute function app.person_rates_log_change();

-- Money: read by those who see it, with their code entered (R105, R106). Written by an admin of the company (R136).
alter table public.person_rates enable row level security;
alter table public.person_rate_changes enable row level security;
create policy person_rates_select on public.person_rates for select to authenticated
  using (app.sees_org_money(org_id));
create policy person_rates_insert on public.person_rates for insert to authenticated
  with check (app.is_org_admin(org_id) and app.aal2());
create policy person_rates_update on public.person_rates for update to authenticated
  using (app.is_org_admin(org_id) and app.aal2()) with check (app.is_org_admin(org_id) and app.aal2());
create policy person_rates_reads_record on public.person_rates as restrictive for select to authenticated
  using (app.reads_org_record(org_id));
create policy person_rate_changes_select on public.person_rate_changes for select to authenticated
  using (app.sees_org_money(org_id));
create policy person_rate_changes_reads_record on public.person_rate_changes as restrictive for select to authenticated
  using (app.reads_org_record(org_id));
grant select, insert, update on public.person_rates to authenticated;
grant select on public.person_rate_changes to authenticated;
grant all on public.person_rates, public.person_rate_changes to service_role;

-- A rename on the staff list (R140) carries the person's rate with it, as it carries their crew rows, tickets and
-- inductions. Same body as 20261019100000, plus the rates; the result names how many moved.
create or replace function public.rename_staff(p_staff_id uuid, p_name text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old   text;
  v_org   uuid;
  v_new   text;
  v_crew  integer;
  v_tix   integer;
  v_ind   integer;
  v_login integer;
  v_rates integer;
  v_who   text;
begin
  select s.name, s.org_id into v_old, v_org from public.staff s where s.id = p_staff_id;
  if not found then
    raise exception 'That person is not on the staff list.' using errcode = 'no_data_found';
  end if;
  if not app.can_manage_crew(v_org) then
    raise exception 'Only the office renames someone on the staff list.' using errcode = 'insufficient_privilege';
  end if;
  v_new := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  if length(v_new) < 2 or v_new !~ '[[:alpha:]]' then
    raise exception 'Give the person their name.' using errcode = 'check_violation';
  end if;
  if v_new = v_old then
    raise exception 'That is already their name.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.staff s where s.org_id = v_org and lower(s.name) = lower(v_new) and s.id <> p_staff_id) then
    raise exception '% is already on the staff list. Two rows that are one person are combined on the Timesheets page, not renamed.', v_new
      using errcode = 'unique_violation';
  end if;

  perform set_config('app.rename', 'on', true);
  update public.staff set name = v_new where id = p_staff_id;
  perform set_config('app.rename', '', true);

  update public.crew c
     set name = v_new,
         aliases = (select array_agg(distinct a) from unnest(coalesce(c.aliases, '{}') || array[v_old]) a where lower(a) <> lower(v_new))
    from public.projects p
   where p.id = c.project_id and p.org_id = v_org
     and lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = lower(v_old);
  get diagnostics v_crew = row_count;

  update public.crew_tickets t set person_name = v_new
   where t.org_id = v_org and lower(regexp_replace(btrim(t.person_name), '\s+', ' ', 'g')) = lower(v_old);
  get diagnostics v_tix = row_count;

  update public.crew_inductions i set person_name = v_new
    from public.projects p
   where p.id = i.project_id and p.org_id = v_org
     and lower(regexp_replace(btrim(i.person_name), '\s+', ' ', 'g')) = lower(v_old);
  get diagnostics v_ind = row_count;

  -- The login that carries the old name on one of this company's jobs takes the new one (README R149).
  update public.profiles pr set full_name = v_new
   where lower(regexp_replace(btrim(coalesce(pr.full_name, '')), '\s+', ' ', 'g')) = lower(v_old)
     and exists (select 1 from public.project_members pm join public.projects p on p.id = pm.project_id where pm.user_id = pr.id and p.org_id = v_org);
  get diagnostics v_login = row_count;

  -- Their charge-out rate (README R158). A live rate already under the new name wins; the old one retires.
  if exists (select 1 from public.person_rates r where r.org_id = v_org and r.active and lower(r.person_name) = lower(v_new)) then
    update public.person_rates r set active = false
     where r.org_id = v_org and r.active and lower(r.person_name) = lower(v_old);
  else
    update public.person_rates r set person_name = v_new
     where r.org_id = v_org and lower(r.person_name) = lower(v_old);
  end if;
  get diagnostics v_rates = row_count;

  delete from public.person_aliases where org_id = v_org and lower(alias) = lower(v_new);
  update public.person_aliases set name = v_new where org_id = v_org and lower(name) = lower(v_old) and lower(alias) <> lower(v_new);
  select pr.full_name into v_who from public.profiles pr where pr.id = (select auth.uid());
  insert into public.person_aliases (org_id, alias, name, note)
  values (v_org, v_old, v_new, coalesce(nullif(btrim(p_note), ''), format('Renamed on the staff list by %s, %s', coalesce(v_who, 'the office'), to_char(app.perth_today(), 'DD/MM/YYYY'))))
  on conflict (org_id, lower(alias)) do update set name = excluded.name, note = excluded.note;

  return jsonb_build_object('old_name', v_old, 'new_name', v_new, 'crew_rows', v_crew, 'tickets', v_tix, 'inductions', v_ind, 'logins', v_login, 'rates', v_rates);
end;
$$;
revoke all on function public.rename_staff(uuid, text, text) from public, anon;
grant execute on function public.rename_staff(uuid, text, text) to authenticated, service_role;
