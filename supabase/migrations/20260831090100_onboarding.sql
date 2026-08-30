-- ============================================================================
-- 20260831090100_onboarding.sql
-- Standing up a new site.
--
-- There is a deliberate chicken-and-egg in the RLS: `organisations` has no
-- insert policy at all, and `projects` may only be inserted by someone who is
-- already an admin of that organisation. That is correct for day-to-day use —
-- nobody should be able to conjure an organisation out of the app — but it
-- leaves no way to create the first one.
--
-- This is that way. SECURITY DEFINER so it can write past those policies,
-- with EXECUTE revoked from anon and authenticated and granted only to
-- service_role, so the only callers are an operator at a terminal and
-- server-side code holding the service key.
--
-- Idempotent on purpose. Onboarding a site is not a one-shot: crew get added
-- as they sign in for the first time, and re-running to pick up the two people
-- who were on leave last week must not create a second project.
-- ============================================================================

create or replace function public.onboard_project(
  p_org_name             text,
  p_org_code             text,
  p_project_name         text,
  p_project_code         text,
  p_admin_email          text,
  p_site_lat             double precision default null,
  p_site_lng             double precision default null,
  p_principal_contractor text default null,
  p_bom_station_id       text default null,
  p_supervisors          text[] default '{}',
  p_pms                  text[] default '{}',
  p_crew                 text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_code     text := upper(btrim(coalesce(p_org_code, '')));
  v_project_code text := upper(btrim(coalesce(p_project_code, '')));
  v_org_id       uuid;
  v_project_id   uuid;
  v_admin_id     uuid;
  v_seated       jsonb := '[]'::jsonb;
  v_unknown      text[] := '{}';
  v_term         text;
begin
  if length(btrim(coalesce(p_org_name, ''))) = 0 then
    raise exception 'An organisation name is required.' using errcode = 'check_violation';
  end if;
  if v_org_code !~ '^[A-Z0-9]{2,8}$' then
    raise exception 'Organisation code % must be 2-8 letters or digits — it becomes the first part of every entry number.', v_org_code
      using errcode = 'check_violation';
  end if;
  if v_project_code !~ '^[A-Z0-9]{2,12}$' then
    raise exception 'Project code % must be 2-12 letters or digits.', v_project_code
      using errcode = 'check_violation';
  end if;

  -- The admin has to have signed in at least once: an entry's author is a real
  -- auth user, and we are not in the business of inventing accounts for people.
  select u.id into v_admin_id
    from auth.users u
   where lower(u.email) = lower(btrim(p_admin_email));

  if v_admin_id is null then
    raise exception 'No account for %. They need to sign in to the app once first — the magic link creates the account.', p_admin_email
      using errcode = 'no_data_found';
  end if;

  insert into public.organisations (name, code)
  values (btrim(p_org_name), v_org_code)
  on conflict (code) do update set name = excluded.name
  returning id into v_org_id;

  insert into public.projects
    (org_id, name, code, site_lat, site_lng, principal_contractor, bom_station_id)
  values (v_org_id, btrim(p_project_name), v_project_code, p_site_lat, p_site_lng,
          nullif(btrim(coalesce(p_principal_contractor, '')), ''),
          nullif(btrim(coalesce(p_bom_station_id, '')), ''))
  on conflict (org_id, code) do update
    set name                 = excluded.name,
        site_lat             = coalesce(excluded.site_lat, public.projects.site_lat),
        site_lng             = coalesce(excluded.site_lng, public.projects.site_lng),
        principal_contractor = coalesce(excluded.principal_contractor,
                                        public.projects.principal_contractor),
        bom_station_id       = coalesce(excluded.bom_station_id, public.projects.bom_station_id)
  returning id into v_project_id;

  -- Report anyone without an account rather than failing on them. Half a crew
  -- seated is better than none, and re-running once the stragglers have signed
  -- in is safe.
  select coalesce(array_agg(distinct x.email order by x.email), '{}')
    into v_unknown
    from (
      select btrim(p_admin_email) as email
      union all select btrim(e) from unnest(coalesce(p_supervisors, '{}')) e
      union all select btrim(e) from unnest(coalesce(p_pms, '{}')) e
    ) x
    left join auth.users u on lower(u.email) = lower(x.email)
   where length(x.email) > 0
     and u.id is null;

  insert into public.project_members (project_id, user_id, role)
  select v_project_id, u.id, x.role
    from (
      select btrim(p_admin_email) as email, 'admin'::public.member_role as role
      union all select btrim(e), 'supervisor'::public.member_role
                  from unnest(coalesce(p_supervisors, '{}')) e
      union all select btrim(e), 'pm'::public.member_role
                  from unnest(coalesce(p_pms, '{}')) e
    ) x
    join auth.users u on lower(u.email) = lower(x.email)
   where length(x.email) > 0
  on conflict (project_id, user_id) do update set role = excluded.role;

  select coalesce(jsonb_agg(jsonb_build_object('email', u.email, 'role', m.role)
                            order by m.role, u.email), '[]'::jsonb)
    into v_seated
    from public.project_members m
    join auth.users u on u.id = m.user_id
   where m.project_id = v_project_id;

  -- Crew names go straight into the transcription vocabulary. Getting these in
  -- before the first recording is most of the difference between "Danny Rowe"
  -- and "Danny Roe" in a signed record.
  foreach v_term in array coalesce(p_crew, '{}') loop
    if length(btrim(v_term)) between 2 and 60 then
      insert into public.project_keywords (project_id, term, category)
      values (v_project_id, btrim(v_term), 'person')
      on conflict (project_id, term) do nothing;
    end if;
  end loop;

  return jsonb_build_object(
    'organisation', jsonb_build_object('id', v_org_id, 'name', btrim(p_org_name), 'code', v_org_code),
    'project', jsonb_build_object('id', v_project_id, 'name', btrim(p_project_name),
                                  'code', v_project_code,
                                  'next_entry_no', app.project_next_entry_no(v_project_id)),
    'members', v_seated,
    'no_account_yet', to_jsonb(v_unknown),
    'crew_keywords', (select count(*) from public.project_keywords
                       where project_id = v_project_id)
  );
end;
$$;

comment on function public.onboard_project is
  'Creates or updates an organisation, a project and its membership. Operator-only: EXECUTE is granted to service_role alone.';

-- The point of this function is that it writes past RLS. It must never be
-- reachable from a browser session.
revoke all on function public.onboard_project(
  text, text, text, text, text, double precision, double precision, text, text,
  text[], text[], text[]) from public, anon, authenticated;

grant execute on function public.onboard_project(
  text, text, text, text, text, double precision, double precision, text, text,
  text[], text[], text[]) to service_role;
