-- ============================================================================
-- 20260907090100_create_project.sql
-- In-app project creation: a new job, without the operator laptop.
--
-- Deliberately narrower than onboard_project (which stays service-role-only):
-- an ORGANISATION can only be born through the operator path, but an admin of
-- an existing project in an org may open the org's next job from the app and
-- is seated as its first admin. Everyone else joins through the members
-- screen, exactly as on any other project.
-- ============================================================================

create or replace function public.create_project(
  p_org_id               uuid,
  p_name                 text,
  p_code                 text,
  p_principal_contractor text default null,
  p_site_lat             double precision default null,
  p_site_lng             double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code    text := upper(btrim(coalesce(p_code, '')));
  v_name    text := btrim(coalesce(p_name, ''));
  v_project uuid;
begin
  if length(v_name) = 0 then
    raise exception 'The project needs a name.' using errcode = 'check_violation';
  end if;
  if v_code !~ '^[A-Z0-9]{2,12}$' then
    raise exception 'The code must be 2–12 letters or digits, like C002.'
      using errcode = 'check_violation';
  end if;

  -- Only an admin somewhere in THIS org opens its next job.
  if not exists (
    select 1
      from public.project_members pm
      join public.projects pr on pr.id = pm.project_id
     where pr.org_id = p_org_id
       and pm.user_id = auth.uid()
       and pm.role = 'admin'
  ) then
    raise exception 'Only an organisation admin can create a project.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.projects where org_id = p_org_id and code = v_code) then
    raise exception 'This organisation already has a project coded %.', v_code
      using errcode = 'unique_violation';
  end if;

  insert into public.projects (org_id, name, code, principal_contractor, site_lat, site_lng)
  values (p_org_id, v_name, v_code, nullif(btrim(coalesce(p_principal_contractor, '')), ''),
          p_site_lat, p_site_lng)
  returning id into v_project;

  insert into public.project_members (project_id, user_id, role)
  values (v_project, auth.uid(), 'admin');

  return jsonb_build_object('project_id', v_project, 'code', v_code, 'name', v_name);
end;
$$;

revoke all on function public.create_project(uuid, text, text, text, double precision, double precision)
  from public, anon;
grant execute on function public.create_project(uuid, text, text, text, double precision, double precision)
  to authenticated, service_role;

comment on function public.create_project is
  'A new job in an existing organisation, created by one of its admins, who is seated as the project''s first admin. Organisations themselves are only created by the operator path.';
