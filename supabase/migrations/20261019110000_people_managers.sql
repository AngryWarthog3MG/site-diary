-- ============================================================================
-- A project manager who manages people (README R150).
--
-- "Fatimah needs to manage people too." R136 kept membership with the admin
-- because a role that sets roles could give itself the money. The office
-- admin's job is exactly membership, so: an admin may mark a PM as managing
-- people on a job, and that PM then adds, removes and retitles people there —
-- within limits the database holds, not the screen: never an admin (made,
-- changed or removed), never the money switch, never their own row, never the
-- manages-people flag itself. The money stays out of reach.
-- ============================================================================

alter table public.project_members add column if not exists manages_people boolean not null default false;
comment on column public.project_members.manages_people is
  'A PM who manages membership on this job (README R150): adds, removes, retitles — never an admin, never the money, never their own row. Set by an admin.';

create or replace function app.can_manage_people(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_project_admin(p_project)
      or exists (select 1 from public.project_members pm
                  where pm.project_id = p_project and pm.user_id = (select auth.uid())
                    and pm.role = 'pm' and pm.manages_people);
$$;
grant execute on function app.can_manage_people(uuid) to authenticated, service_role;

drop policy if exists project_members_insert_admin on public.project_members;
create policy project_members_insert_admin on public.project_members
  for insert to authenticated
  with check (app.can_manage_people(project_id) or app.is_org_admin((select p.org_id from public.projects p where p.id = project_id)));
drop policy if exists project_members_update_admin on public.project_members;
create policy project_members_update_admin on public.project_members
  for update to authenticated
  using (app.can_manage_people(project_id)) with check (app.can_manage_people(project_id));
drop policy if exists project_members_delete_admin on public.project_members;
create policy project_members_delete_admin on public.project_members
  for delete to authenticated
  using (app.can_manage_people(project_id));

-- The limits on a people-manager who is not an admin. The service role and admins pass through.
create or replace function app.people_manager_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid := coalesce(new.project_id, old.project_id);
  v_target  uuid := coalesce(new.user_id, old.user_id);
begin
  if current_user <> 'authenticated' or (select auth.uid()) is null then return coalesce(new, old); end if;
  if app.is_project_admin(v_project) then return coalesce(new, old); end if;
  -- Not an admin: only a PM who manages people reaches here (the policies), and only this far.
  if v_target = (select auth.uid()) then
    raise exception 'You do not change your own membership — ask an admin.' using errcode = 'insufficient_privilege';
  end if;
  if (tg_op <> 'INSERT' and old.role = 'admin') or (tg_op <> 'DELETE' and new.role = 'admin') then
    raise exception 'Only an admin makes, changes or removes an admin.' using errcode = 'insufficient_privilege';
  end if;
  if tg_op <> 'DELETE' then
    if new.finance is not null and (tg_op = 'INSERT' or new.finance is distinct from old.finance) then
      raise exception 'The money switch is an admin''s to set.' using errcode = 'insufficient_privilege';
    end if;
    if new.manages_people and (tg_op = 'INSERT' or not old.manages_people) then
      raise exception 'Only an admin says who manages people.' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists project_members_people_manager_limits on public.project_members;
create trigger project_members_people_manager_limits before insert or update or delete on public.project_members
  for each row execute function app.people_manager_limits();
