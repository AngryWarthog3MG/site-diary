-- Two-factor sign-in for the money (README R106). "Build the two factor sign in."
--
-- The money (README R105) now opens only in a session that has passed a second factor: a code from an authenticator
-- app. Supabase stamps the session's JWT with aal = 'aal2' once the code is verified; app.sees_money asks for it, so
-- every money path — the values, the claimed totals, the rate card, the build-up, pricing — needs it, with no screen
-- involved. Entitlement is unchanged (app.role_sees_money); a person entitled but signed in with the email link alone
-- keeps the rest of the app and is asked for their code.
--
-- Granting the money needs it too. Otherwise anyone holding an admin's email link could add an account of their own
-- as a PM — who sees money by default — set up a code on it, and read the figures. So adding someone who would see
-- the money, raising a role to one that does, or switching someone's money on, is refused unless the admin doing it is
-- at aal2. A person's own row is exempt (create_project seats its creator as admin), and so is anything not made by a
-- signed-in request; the one service-role path that adds members (the bulk add) checks the code itself.

create or replace function app.aal2()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2';
$$;
grant execute on function app.aal2() to authenticated;

create or replace function app.sees_money(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.aal2() and exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project and pm.user_id = (select auth.uid())
       and app.role_sees_money(pm.role::text, pm.finance));
$$;

create or replace function app.sees_org_money(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.aal2() and exists (
    select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
     where p.org_id = p_org and pm.user_id = (select auth.uid())
       and app.role_sees_money(pm.role::text, pm.finance));
$$;

create or replace function app.can_read_rates(p_org uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_project is not null then app.can_manage_registers(p_project) and app.sees_money(p_project)
    else app.aal2() and exists (
      select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
       where p.org_id = p_org and pm.user_id = (select auth.uid()) and pm.role::text in ('supervisor', 'pm', 'admin')
         and app.role_sees_money(pm.role::text, pm.finance))
  end;
$$;

create or replace function app.can_write_rates(p_org uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_project is not null then app.is_office(p_project) and app.sees_money(p_project)
    else app.aal2() and exists (
      select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
       where p.org_id = p_org and pm.user_id = (select auth.uid()) and pm.role::text in ('pm', 'admin')
         and app.role_sees_money(pm.role::text, pm.finance))
  end;
$$;

-- Granting the money needs the granter's code.
-- Security invoker on purpose: it asks who is making the change. Only a signed-in request (current_user
-- 'authenticated') is checked; the service role, the database owner and definer functions such as create_project
-- are not — the one service-role path that adds members checks the code itself.
create or replace function app.money_grant_needs_code()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_after boolean := app.role_sees_money(new.role::text, new.finance);
  v_before boolean := case when tg_op = 'UPDATE' then app.role_sees_money(old.role::text, old.finance) else false end;
begin
  if current_user <> 'authenticated' or (select auth.uid()) is null or new.user_id = (select auth.uid()) then return new; end if;
  if v_after and not v_before and not app.aal2() then
    raise exception 'Giving someone the money needs your two-factor code. Enter it under Security, then try again.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger project_members_money_grant before insert or update on public.project_members
  for each row execute function app.money_grant_needs_code();

-- An admin resetting someone's lost authenticator is an access change: it goes in the same log.
alter table public.member_access_events drop constraint member_access_events_kind_check;
alter table public.member_access_events add constraint member_access_events_kind_check
  check (kind in ('added', 'changed', 'removed', 'two_factor_reset'));
