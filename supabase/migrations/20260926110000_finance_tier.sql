-- The finance tier (README R105). Mitchell: "a lot of the financials and company financial data would be in this
-- app as well, so I need to keep that separate and locked away from individuals who use the app."
--
-- Money is its own permission, separate from the screens a person may open:
--   * an admin always sees it; a project manager does unless an admin switches it off; a supervisor does not unless an
--     admin switches it on; a leading hand and a labourer never do. Per person, per job: project_members.finance
--     (null = the role's default).
--   * it is enforced here, not by hiding things on a screen: the register's value columns and a submission's claimed
--     total cannot be selected by a signed-in account at all (column privileges); they come back only through
--     functions that ask app.sees_money first; the rate card and the build-up are readable and writable only with it.
--   * every change to who is on a job, their role, their screens or their money access is kept (member_access_events),
--     so an access review can say who could see what, and who decided.
--
-- Not covered, on purpose: the three legacy per-day estimates typed on diary rows before the register held values
-- (variations.estimated_cost). They are part of signed days — in the hash and in stored PDFs — and the signed record
-- does not change. The screens stop showing them to anyone without money access.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Who sees money.

alter table public.project_members add column finance boolean;
comment on column public.project_members.finance is
  'Whether this person sees the money on this job. Null = the role''s default: admin always, pm yes, supervisor no; leading hand and labourer never. README R105.';

create or replace function app.role_sees_money(p_role text, p_finance boolean)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_role = 'admin' then true
    when p_role in ('pm', 'supervisor') then coalesce(p_finance, p_role = 'pm')
    else false
  end;
$$;

create or replace function app.sees_money(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project and pm.user_id = (select auth.uid())
       and app.role_sees_money(pm.role::text, pm.finance));
$$;

create or replace function app.sees_org_money(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
     where p.org_id = p_org and pm.user_id = (select auth.uid())
       and app.role_sees_money(pm.role::text, pm.finance));
$$;
grant execute on function app.role_sees_money(text, boolean), app.sees_money(uuid), app.sees_org_money(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Who could see what, and who decided: every membership change, kept.

create table public.member_access_events (
  id            bigint generated always as identity primary key,
  project_id    uuid not null references public.projects (id) on delete cascade,
  user_id       uuid not null,
  kind          text not null check (kind in ('added', 'changed', 'removed')),
  old_role      text,
  new_role      text,
  old_screens   text[],
  new_screens   text[],
  old_finance   boolean,
  new_finance   boolean,
  money_before  boolean not null,
  money_after   boolean not null,
  changed_by    uuid,
  changed_at    timestamptz not null default now()
);
create index member_access_events_project on public.member_access_events (project_id, changed_at desc);

create or replace function app.log_member_access()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.member_access_events (project_id, user_id, kind, new_role, new_screens, new_finance, money_before, money_after, changed_by)
    values (new.project_id, new.user_id, 'added', new.role::text, new.screens, new.finance, false, app.role_sees_money(new.role::text, new.finance), auth.uid());
    return null;
  elsif tg_op = 'DELETE' then
    insert into public.member_access_events (project_id, user_id, kind, old_role, old_screens, old_finance, money_before, money_after, changed_by)
    values (old.project_id, old.user_id, 'removed', old.role::text, old.screens, old.finance, app.role_sees_money(old.role::text, old.finance), false, auth.uid());
    return null;
  end if;
  if new.role is distinct from old.role or new.screens is distinct from old.screens or new.finance is distinct from old.finance then
    insert into public.member_access_events (project_id, user_id, kind, old_role, new_role, old_screens, new_screens, old_finance, new_finance, money_before, money_after, changed_by)
    values (new.project_id, new.user_id, 'changed', old.role::text, new.role::text, old.screens, new.screens, old.finance, new.finance,
            app.role_sees_money(old.role::text, old.finance), app.role_sees_money(new.role::text, new.finance), auth.uid());
  end if;
  return null;
end;
$$;
create trigger project_members_log_access after insert or update or delete on public.project_members
  for each row execute function app.log_member_access();

alter table public.member_access_events enable row level security;
create policy member_access_events_select on public.member_access_events for select to authenticated using (app.is_project_admin(project_id));
grant select on public.member_access_events to authenticated;
grant all on public.member_access_events to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. The register's money cannot be selected by a signed-in account. Everything else on it can, as before.

revoke select on public.variation_register from authenticated, anon;
grant select (id, project_id, seq, title, vr_ref, raised_on, status, submitted_on, decided_on, paid_on, notes, created_at, updated_at, estimate_source)
  on public.variation_register to authenticated;

revoke select on public.variation_status_events from authenticated, anon;
grant select (id, register_id, status, note, changed_by, changed_at) on public.variation_status_events to authenticated;

-- The money, for those who see it: an empty answer for anyone else, never an error that says something is there.
create or replace function public.variation_values(p_project uuid)
returns table (register_id uuid, estimated_cost numeric, agreed_cost numeric, estimate_source text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.estimated_cost, r.agreed_cost, r.estimate_source
    from public.variation_register r
   where r.project_id = p_project and app.sees_money(p_project);
$$;

create or replace function public.variation_submissions(p_register uuid)
returns table (changed_at timestamptz, claimed_total numeric, claimed_lines integer)
language sql stable security definer set search_path = '' as $$
  select e.changed_at, e.claimed_total, e.claimed_lines
    from public.variation_status_events e
    join public.variation_register r on r.id = e.register_id
   where e.register_id = p_register and e.status::text = 'submitted' and app.sees_money(r.project_id)
   order by e.changed_at;
$$;
revoke all on function public.variation_values(uuid), public.variation_submissions(uuid) from public, anon;
grant execute on function public.variation_values(uuid), public.variation_submissions(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. The two functions that hand back a register row blank the money for a caller who does not see it, and pricing
--    needs it. A keeper without money access still moves a variation, names it and sets the client's reference.

create or replace function public.set_variation_status(p_register_id uuid, p_status public.variation_status, p_note text default null)
returns public.variation_register language plpgsql security definer set search_path = public as $$
declare v_row public.variation_register;
begin
  select * into v_row from public.variation_register where id = p_register_id;
  if not found or not app.can_manage_registers(v_row.project_id) then
    raise exception 'Your role on this job does not include the variation register.';
  end if;
  update public.variation_register r
     set status       = p_status,
         submitted_on = case when p_status = 'submitted' then coalesce(r.submitted_on, app.perth_today()) else r.submitted_on end,
         decided_on   = case when p_status in ('approved', 'rejected') then coalesce(r.decided_on, app.perth_today()) else r.decided_on end,
         paid_on      = case when p_status = 'paid' then coalesce(r.paid_on, app.perth_today()) else r.paid_on end
   where r.id = p_register_id returning * into v_row;
  insert into public.variation_status_events (register_id, status, note, changed_by)
  values (p_register_id, p_status, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
  if not app.sees_money(v_row.project_id) then
    v_row.estimated_cost := null;
    v_row.agreed_cost := null;
  end if;
  return v_row;
end; $$;

create or replace function public.set_variation_details(
  p_register_id uuid, p_vr_ref text, p_agreed_cost numeric, p_notes text,
  p_estimated_cost numeric default null, p_keep_estimate boolean default true)
returns public.variation_register language plpgsql security definer set search_path = '' as $$
declare
  v_row public.variation_register;
  v_money boolean;
begin
  select * into v_row from public.variation_register where id = p_register_id;
  if not found then raise exception 'No such variation on the register.' using errcode = 'no_data_found'; end if;
  if not app.can_manage_registers(v_row.project_id) then
    raise exception 'Only someone who keeps the registers can price a variation.' using errcode = 'insufficient_privilege';
  end if;
  v_money := app.sees_money(v_row.project_id);
  if v_money and p_agreed_cost is not null and p_agreed_cost < 0 then raise exception 'An agreed value cannot be negative.' using errcode = 'check_violation'; end if;
  if v_money and p_estimated_cost is not null and p_estimated_cost < 0 then raise exception 'An estimated value cannot be negative.' using errcode = 'check_violation'; end if;
  update public.variation_register r
     set vr_ref = nullif(btrim(coalesce(p_vr_ref, '')), ''),
         notes = nullif(btrim(coalesce(p_notes, '')), ''),
         -- Money only from someone who sees it (README R105); anyone else's call leaves it exactly as it was.
         agreed_cost = case when v_money then p_agreed_cost else r.agreed_cost end,
         -- A variation with a build-up is estimated by its lines (README R104).
         estimated_cost = case when not v_money or p_keep_estimate or r.estimate_source = 'build_up' then r.estimated_cost else p_estimated_cost end
   where r.id = p_register_id
  returning * into v_row;
  if not v_money then
    v_row.estimated_cost := null;
    v_row.agreed_cost := null;
  end if;
  return v_row;
end;
$$;
grant execute on function public.set_variation_details(uuid, text, numeric, text, numeric, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. The rate card and the build-up are money. Same policies as R104; the functions they call now ask for it.

create or replace function app.can_read_rates(p_org uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_project is not null then app.can_manage_registers(p_project) and app.sees_money(p_project)
    else exists (
      select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
       where p.org_id = p_org and pm.user_id = (select auth.uid()) and pm.role::text in ('supervisor', 'pm', 'admin')
         and app.role_sees_money(pm.role::text, pm.finance))
  end;
$$;

create or replace function app.can_write_rates(p_org uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_project is not null then app.is_office(p_project) and app.sees_money(p_project)
    else exists (
      select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
       where p.org_id = p_org and pm.user_id = (select auth.uid()) and pm.role::text in ('pm', 'admin')
         and app.role_sees_money(pm.role::text, pm.finance))
  end;
$$;

create or replace function app.can_cost_variations(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.can_manage_registers(p_project) and app.sees_money(p_project);
$$;
grant execute on function app.can_cost_variations(uuid) to authenticated;

alter policy variation_cost_lines_select on public.variation_cost_lines using (app.can_cost_variations(project_id));
alter policy variation_cost_lines_insert on public.variation_cost_lines with check (app.can_cost_variations(project_id));
alter policy variation_cost_lines_update on public.variation_cost_lines using (app.can_cost_variations(project_id)) with check (app.can_cost_variations(project_id));
alter policy variation_cost_lines_delete on public.variation_cost_lines using (app.can_cost_variations(project_id));

-- ---------------------------------------------------------------------------------------------------------------
-- 6. A caller may ask whether THEY see the money on a job — the screens and exports decide what to draw from it.
create or replace function public.sees_money(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.sees_money(p_project);
$$;
revoke all on function public.sees_money(uuid) from public, anon;
grant execute on function public.sees_money(uuid) to authenticated, service_role;
