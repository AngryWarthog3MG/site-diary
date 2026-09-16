-- Construction records: the WHS management plan only for a principal contractor; excavations carry their services
-- information and a trench control at depth; both stand once recorded.
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
      raise exception 'TESTFAIL: wrong error for [%] — got "%", expected "%"', p_sql, sqlerrm, p_fragment;
    end if;
end;
$$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'sup@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'lh@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'admin@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'leading_hand'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'admin');

-- Not the principal contractor: no WHS management plan may be issued.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select is_principal_contractor from public.projects where id = 'bbbbbbbb-0000-0000-0000-000000000001') = false,
    'a job was principal contractor by default';
end $$;
select tests.expect_error($q$
  insert into public.whs_management_plans (project_id, version, responsibilities, consultation_arrangements, incident_arrangements, site_rules, swms_arrangements)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 0, 'a', 'b', 'c', 'd', 'e')
$q$, 'only the principal contractor');

-- The admin marks the job; the supervisor issues two versions, numbered by the database.
reset role;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;
update public.projects set is_principal_contractor = true where id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.whs_management_plans (id, project_id, version, responsibilities, consultation_arrangements, incident_arrangements, site_rules, swms_arrangements)
values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 42, 'Supervisor: Matt', 'Weekly meeting', 'Reported same shift', 'PPE, speed limit', 'Checked before start');
insert into public.whs_management_plans (id, project_id, version, responsibilities, consultation_arrangements, incident_arrangements, site_rules, swms_arrangements, revision_reason)
values ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 1, 'Supervisor: Matt; PM: Sue', 'Weekly meeting', 'Reported same shift', 'PPE, speed limit', 'Checked before start', 'Stage 2 starts');
do $$ begin
  assert (select array_agg(version order by version) from public.whs_management_plans) = array[1, 2], 'versions not numbered 1 and 2';
  raise notice 'PASS  only a principal contractor issues the plan, and versions are numbered by the database';
end $$;
select tests.expect_error($q$
  insert into public.whs_management_plans (project_id, version, responsibilities, consultation_arrangements, incident_arrangements, site_rules, swms_arrangements)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 0, 'a', '   ', 'c', 'd', 'e')
$q$, 'check constraint');
update public.whs_management_plans set site_rules = 'none' where id = 'cccccccc-0000-0000-0000-000000000001';
do $$ begin
  assert (select site_rules from public.whs_management_plans where id = 'cccccccc-0000-0000-0000-000000000001') = 'PPE, speed limit', 'an issued plan was rewritten';
  raise notice 'PASS  every heading is required and an issued version never changes';
end $$;

-- A leading hand records an excavation. Services information needs its reference; a deep trench needs its control.
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
insert into public.excavation_records (id, project_id, location, info_reference, info_obtained_on, max_depth_m, trench_control)
values ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', ' Car park stormwater ', ' 31415926 ', current_date - 2, 2.1, 'shoring');
insert into public.excavation_records (project_id, location, info_reference, info_obtained_on, max_depth_m)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'Kerb footing', '31415927', current_date - 1, 0.6);
do $$ begin
  assert (select location from public.excavation_records where id = 'dddddddd-0000-0000-0000-000000000001') = 'Car park stormwater', 'location not trimmed';
  assert (select recorded_by from public.excavation_records where id = 'dddddddd-0000-0000-0000-000000000001') = '22222222-2222-2222-2222-222222222222', 'recorder not stamped';
  raise notice 'PASS  a leading hand records excavations, a shallow one needing no trench control';
end $$;
select tests.expect_error($q$
  insert into public.excavation_records (project_id, location, info_reference, info_obtained_on, max_depth_m)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Deep sewer', '1', current_date, 1.5)
$q$, 'excavation_trench_controlled');
select tests.expect_error($q$
  insert into public.excavation_records (project_id, location, info_reference, info_obtained_on, max_depth_m, trench_control)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Deep sewer', '1', current_date, 3, 'engineer_advice')
$q$, 'excavation_engineer_in_writing');
select tests.expect_error($q$
  insert into public.excavation_records (project_id, location, info_reference, info_obtained_on)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'No reference', '  ', current_date)
$q$, 'check constraint');
select tests.expect_error($q$
  insert into public.excavation_records (project_id, location, info_reference, info_obtained_on)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Future', '1', current_date + 5)
$q$, 'in the future');
update public.excavation_records set trench_control = null where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ begin
  assert (select trench_control from public.excavation_records where id = 'dddddddd-0000-0000-0000-000000000001') = 'shoring', 'an excavation record was rewritten';
  raise notice 'PASS  reg. 304 needs a reference, reg. 306 a control at 1.5 m, engineer advice its reference, and records stand';
end $$;
-- A leading hand does not write the WHS management plan.
select tests.expect_error($q$
  insert into public.whs_management_plans (project_id, version, responsibilities, consultation_arrangements, incident_arrangements, site_rules, swms_arrangements)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 0, 'a', 'b', 'c', 'd', 'e')
$q$, 'row-level security');

reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL CONSTRUCTION RECORD TESTS PASSED'; end $$;
rollback;
