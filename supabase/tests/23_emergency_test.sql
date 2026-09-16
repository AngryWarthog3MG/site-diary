-- Emergency plans and drills: versions numbered by the database and frozen; the labourer reads the plan, not the drills.
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
  ('55555555-5555-5555-5555-555555555555', 'lab@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Southern', 'C002');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'leading_hand'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'labourer');

-- The supervisor issues the plan twice. The database numbers the versions, whatever is sent.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.emergency_plans (id, project_id, version, muster_point, evacuation_procedure, test_every_months, first_aiders)
values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 99, '  Car park by the green gate ', 'Three blasts, walk to the muster point', 6, array[' Evan ', '', 'Matt']);
insert into public.emergency_plans (id, project_id, version, muster_point, evacuation_procedure, test_every_months)
values ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 1, 'Site office', 'Three blasts', 3);
insert into public.emergency_plans (id, project_id, version, muster_point, evacuation_procedure, test_every_months)
values ('cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002', 7, 'South gate', 'Horn', 6);
do $$ begin
  assert (select version from public.emergency_plans where id = 'cccccccc-0000-0000-0000-000000000001') = 1, 'the first version was not numbered 1';
  assert (select version from public.emergency_plans where id = 'cccccccc-0000-0000-0000-000000000002') = 2, 'the second version was not numbered 2';
  assert (select version from public.emergency_plans where id = 'cccccccc-0000-0000-0000-000000000003') = 1, 'another workplace did not start at 1';
  assert (select muster_point from public.emergency_plans where id = 'cccccccc-0000-0000-0000-000000000001') = 'Car park by the green gate', 'muster point not trimmed';
  assert (select first_aiders from public.emergency_plans where id = 'cccccccc-0000-0000-0000-000000000001') = array['Evan', 'Matt'], 'first aiders not tidied';
  assert (select issued_by from public.emergency_plans where id = 'cccccccc-0000-0000-0000-000000000001') = '11111111-1111-1111-1111-111111111111', 'issuer not stamped';
  raise notice 'PASS  versions are numbered per workplace by the database';
end $$;

-- A plan needs its muster point, its evacuation and a sane test frequency.
select tests.expect_error($q$
  insert into public.emergency_plans (project_id, muster_point, evacuation_procedure, test_every_months)
  values ('bbbbbbbb-0000-0000-0000-000000000001', '   ', 'Horn', 6)
$q$, 'check constraint');
select tests.expect_error($q$
  insert into public.emergency_plans (project_id, muster_point, evacuation_procedure, test_every_months)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Gate', 'Horn', 60)
$q$, 'check constraint');

-- An issued version never changes: the update reaches no row, and the service role is stopped by the trigger.
update public.emergency_plans set muster_point = 'Somewhere else' where id = 'cccccccc-0000-0000-0000-000000000001';
do $$ begin
  assert (select muster_point from public.emergency_plans where id = 'cccccccc-0000-0000-0000-000000000001') = 'Car park by the green gate', 'an issued plan was rewritten';
end $$;
reset role;
select tests.expect_error($q$
  update public.emergency_plans set muster_point = 'x' where id = 'cccccccc-0000-0000-0000-000000000001'
$q$, 'never changed or removed');
do $$ begin raise notice 'PASS  an issued version never changes'; end $$;

-- The leading hand records a drill against this workplace's plan, never another's, never in the future.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
insert into public.emergency_drills (id, project_id, plan_id, held_on, scenario, participants, muster_minutes)
values ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', current_date - 1, 'Unannounced evacuation', 11, 3.5);
select tests.expect_error($q$
  insert into public.emergency_drills (project_id, plan_id, held_on, scenario)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003', current_date - 1, 'Wrong plan')
$q$, 'not this workplace');
select tests.expect_error($q$
  insert into public.emergency_drills (project_id, plan_id, held_on, scenario)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', current_date + 30, 'Future')
$q$, 'before it is held');
-- The leading hand may not issue the plan itself.
select tests.expect_error($q$
  insert into public.emergency_plans (project_id, muster_point, evacuation_procedure, test_every_months)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Gate', 'Horn', 6)
$q$, 'row-level security');
do $$ begin
  assert (select conducted_by from public.emergency_drills where id = 'dddddddd-0000-0000-0000-000000000001') = '22222222-2222-2222-2222-222222222222', 'drill not stamped';
  raise notice 'PASS  a leading hand records a drill, against this workplace only, and cannot issue the plan';
end $$;

-- THE LABOURER READS THE PLAN — the muster point is for them — and not the drills.
reset role;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.emergency_plans) = 2, 'a labourer cannot read their workplace''s emergency plan';
  assert (select count(*) from public.emergency_drills) = 0, 'a labourer read the drill records';
  raise notice 'PASS  a labourer reads the emergency plan and not the drills — reg. 43(1)(c)';
end $$;
select tests.expect_error($q$
  insert into public.emergency_drills (project_id, plan_id, held_on, scenario)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', current_date, 'Mine')
$q$, 'row-level security');

reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL EMERGENCY TESTS PASSED'; end $$;
rollback;
