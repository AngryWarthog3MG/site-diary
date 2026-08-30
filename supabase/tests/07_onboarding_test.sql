-- ============================================================================
-- supabase/tests/07_onboarding_test.sql
--
-- Covers standing up a new site:
--   * it creates the organisation, the project and the membership in one go
--   * it is idempotent — re-running does not create a second project
--   * re-running picks up crew who have signed in since
--   * it refuses to invent an account for the admin
--   * codes are normalised and validated, because they become entry numbers
--   * a signed-in user cannot call it
--
-- Runs in one transaction and rolls back.
-- ============================================================================

begin;

create schema tests;
grant usage on schema tests to public;

create function tests.expect_error(p_sql text, p_fragment text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TESTFAIL: expected failure but statement succeeded: %', p_sql;
exception
  when others then
    if sqlerrm like 'TESTFAIL:%' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'TESTFAIL: wrong error for [%] — got "%", expected "%"',
        p_sql, sqlerrm, p_fragment;
    end if;
end;
$$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'boss@kingsbridge.example'),
  ('22222222-2222-2222-2222-222222222222', 'danny@kingsbridge.example'),
  ('33333333-3333-3333-3333-333333333333', 'priya@kingsbridge.example');

-- ---------------------------------------------------------------------------
-- 1. One call stands up a site
-- ---------------------------------------------------------------------------
do $$
declare r jsonb;
begin
  r := public.onboard_project(
    p_org_name     => 'Kingsbridge Civil',
    p_org_code     => 'kbs',                    -- lower case on purpose
    p_project_name => 'Northern Interchange Stage 2',
    p_project_code => 'c001',
    p_admin_email  => 'boss@kingsbridge.example',
    p_site_lat     => -31.9523,
    p_site_lng     => 115.8613,
    p_principal_contractor => 'Lendlease',
    p_supervisors  => array['danny@kingsbridge.example', 'newstart@kingsbridge.example'],
    p_pms          => array['priya@kingsbridge.example'],
    p_crew         => array['Danny Rowe', 'Sam Whitely', 'Kel Brady']
  );

  assert r -> 'organisation' ->> 'code' = 'KBS', 'org code was not normalised to upper case';
  assert r -> 'project' ->> 'code' = 'C001', 'project code was not normalised';
  assert r -> 'project' ->> 'next_entry_no' ~ '^KBS-\d{4}-\d{2}-\d{2}$',
         format('first entry reference would be %s', r -> 'project' ->> 'next_entry_no');
  assert jsonb_array_length(r -> 'members') = 3, format('seated %s', r -> 'members');
  assert (r ->> 'crew_keywords')::int = 3, 'crew names did not reach the vocabulary';

  -- Someone who has not signed in yet is reported, not fatal.
  assert r -> 'no_account_yet' = '["newstart@kingsbridge.example"]'::jsonb,
         format('expected one unknown email, got %s', r -> 'no_account_yet');

  raise notice 'PASS  one call stands up the org, project, crew and vocabulary';
end;
$$;

do $$
begin
  assert (select m.role from public.project_members m
           join auth.users u on u.id = m.user_id
          where u.email = 'boss@kingsbridge.example')::text = 'admin', 'admin not seated';
  assert (select m.role from public.project_members m
           join auth.users u on u.id = m.user_id
          where u.email = 'priya@kingsbridge.example')::text = 'pm', 'PM not seated';
  assert (select site_lat from public.projects where code = 'C001' and org_id = (select id from public.organisations where code = 'KBS')) = -31.9523,
         'site coordinates not stored — weather would never work';
  raise notice 'PASS  roles and site coordinates are set correctly';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Running it again does not stand up a second site
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values ('44444444-4444-4444-4444-444444444444', 'newstart@kingsbridge.example');

do $$
declare r jsonb;
begin
  r := public.onboard_project(
    p_org_name     => 'Kingsbridge Civil',
    p_org_code     => 'KBS',
    p_project_name => 'Northern Interchange Stage 2',
    p_project_code => 'C001',
    p_admin_email  => 'boss@kingsbridge.example',
    p_supervisors  => array['danny@kingsbridge.example', 'newstart@kingsbridge.example'],
    p_crew         => array['Danny Rowe', 'Toby Nguyen']
  );

  -- Scoped to this fixture's own codes. These two run before any SET ROLE, so
  -- they see the whole table — and a suite that only passes on an empty
  -- database is no use against the one that matters.
  assert (select count(*) from public.organisations where code = 'KBS') = 1,
         'a second organisation was created';
  assert (select count(*) from public.projects where code = 'C001' and org_id = (select id from public.organisations where code = 'KBS')) = 1,
         'a second project was created';
  assert jsonb_array_length(r -> 'members') = 4, 'the late starter was not picked up';
  assert r -> 'no_account_yet' = '[]'::jsonb, 'still reporting a missing account';
  assert (r ->> 'crew_keywords')::int = 4, 'the new crew name was not added';

  -- Omitted optional fields must not wipe what is already there.
  assert (select site_lat from public.projects where code = 'C001' and org_id = (select id from public.organisations where code = 'KBS')) = -31.9523,
         're-running erased the site coordinates';
  assert (select principal_contractor from public.projects where code = 'C001' and org_id = (select id from public.organisations where code = 'KBS')) = 'Lendlease',
         're-running erased the principal contractor';

  raise notice 'PASS  re-running seats new crew without disturbing the project';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. What it refuses
-- ---------------------------------------------------------------------------
select tests.expect_error($q$
  select public.onboard_project('Nobody Ltd', 'NOB', 'Site', 'S001', 'ghost@example.com')
$q$, 'need to sign in');

select tests.expect_error($q$
  select public.onboard_project('Kingsbridge Civil', 'K', 'Site', 'S001',
                                'boss@kingsbridge.example')
$q$, 'Organisation code');

select tests.expect_error($q$
  select public.onboard_project('Kingsbridge Civil', 'KBS', 'Site', 'this-code-is-far-too-long',
                                'boss@kingsbridge.example')
$q$, 'Project code');

select tests.expect_error($q$
  select public.onboard_project('   ', 'KBS', 'Site', 'S002', 'boss@kingsbridge.example')
$q$, 'organisation name is required');

do $$ begin raise notice 'PASS  bad input is refused with a message worth reading'; end; $$;

-- ---------------------------------------------------------------------------
-- 4. A signed-in user cannot call it
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;

select tests.expect_error($q$
  select public.onboard_project('Rogue Pty', 'RGE', 'Theirs', 'X001',
                                'danny@kingsbridge.example')
$q$, 'permission denied');

do $$
begin
  -- And they certainly cannot do it the direct way either.
  assert (select count(*) from public.organisations) = 1,
         'a supervisor can see organisations they were never seated on';
  raise notice 'PASS  onboarding is out of reach of a signed-in session';
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice ''; raise notice 'ALL ONBOARDING TESTS PASSED'; end; $$;

rollback;
