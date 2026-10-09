-- ============================================================================
-- The project manager runs the job (README R136).
--
-- "Project manager has all rights apart from Rates and can't see money." Until
-- now the PM read everything and wrote nothing — a reader's role — so the
-- moment Mitchell made Matty a PM to hide the money, Matty could no longer
-- edit the day. The role is now the office's working role: everything an
-- admin does on the job and in the company EXCEPT
--   * the money — off by default (the finance switch still exists, admin-set);
--   * the rate card — admin only, however the money is set;
--   * membership, roles and the money switch — admin only, because a role
--     that could set roles could give itself the money (R105/R106);
--   * appointing health record keepers and creating jobs — admin only.
-- The TS twins in src/lib/roles.ts change in the same commit.
-- ============================================================================

create or replace function app.can_author_entries(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.project_role(p_project_id) in ('supervisor', 'admin', 'pm')
$$;

create or replace function app.can_run_talks(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project
       and pm.user_id = (select auth.uid())
       and pm.role::text in ('supervisor', 'admin', 'pm', 'leading_hand')
  )
$$;

create or replace function app.can_sign_in(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project
       and pm.user_id = (select auth.uid())
       and pm.role::text in ('supervisor', 'admin', 'pm', 'leading_hand', 'labourer')
  )
$$;

create or replace function app.can_report(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project
       and pm.user_id = (select auth.uid())
       and pm.role::text in ('supervisor', 'admin', 'pm', 'leading_hand', 'labourer')
  )
$$;

create or replace function app.can_manage_crew(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.project_members pm
      join public.projects p on p.id = pm.project_id
     where p.org_id = p_org_id
       and pm.user_id = auth.uid()
       and pm.role in ('supervisor', 'admin', 'pm')
  );
$$;

create or replace function app.can_manage_incidents(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project
       and pm.user_id = (select auth.uid())
       and pm.role::text in ('supervisor', 'admin', 'pm')
  );
$$;

create or replace function app.can_write_swms(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project
       and pm.user_id = (select auth.uid())
       and pm.role::text in ('supervisor', 'admin', 'pm')
  );
$$;

-- The money: a PM no longer sees it by default. The switch stays for the admin to set by hand.
create or replace function app.role_sees_money(p_role text, p_finance boolean)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_role = 'admin' then true
    when p_role in ('pm', 'supervisor') then coalesce(p_finance, false)
    else false
  end;
$$;
comment on column public.project_members.finance is
  'Whether this person sees the money on this job. Null = the role''s default: admin always, pm and supervisor no; leading hand and labourer never. README R105, R136.';

-- The rate card is written by an admin alone, whatever the money switch says (R136).
create or replace function app.can_write_rates(p_org uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_project is not null then app.is_project_admin(p_project) and app.sees_money(p_project)
    else app.aal2() and exists (
      select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
       where p.org_id = p_org and pm.user_id = (select auth.uid()) and pm.role::text = 'admin')
  end;
$$;

-- The company's screens the PM now opens write through the office, not the admin alone.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (app.is_org_office(org_id) and sender_id = (select auth.uid()));
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (recipient_id = (select auth.uid()) or sender_id = (select auth.uid()) or app.is_org_office(org_id));
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update to authenticated
  using (recipient_id = (select auth.uid()) or app.is_org_office(org_id)) with check (true);

drop policy if exists timesheet_entries_insert on public.timesheet_entries;
create policy timesheet_entries_insert on public.timesheet_entries for insert to authenticated
  with check (app.is_org_office(org_id));
drop policy if exists timesheet_entries_void on public.timesheet_entries;
create policy timesheet_entries_void on public.timesheet_entries for update to authenticated
  using (app.is_org_office(org_id)) with check (app.is_org_office(org_id));
