-- Plant inspections and registration: records name the competent person and stand; unregistered plant is not prestarted.
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
  ('33333333-3333-3333-3333-333333333333', 'pm@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'lab@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'pm'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'labourer');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.plant_register (id, org_id, name, kind) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '5t excavator', 'excavator'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Franna crane', 'other');
do $$ begin
  assert (select registration_required from public.plant_register where id = 'cccccccc-0000-0000-0000-000000000001') = false,
    'registration was switched on by default — most civil plant is not registrable';
end $$;

-- The basis and interval are facts about the machine, and the cascade's values are constrained.
update public.plant_register set inspection_basis = 'manufacturer', inspection_interval_months = 6 where id = 'cccccccc-0000-0000-0000-000000000001';
select tests.expect_error($q$
  update public.plant_register set inspection_basis = 'whenever' where id = 'cccccccc-0000-0000-0000-000000000001'
$q$, 'check constraint');

-- A record names the competent person, is stamped, and stands.
insert into public.plant_maintenance_records (id, plant_id, kind, done_on, performed_by_name, competence, next_due_on, created_by)
values ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'inspection', current_date - 3,
        '  Sam Fixer ', ' Licensed plant mechanic ', current_date + 180, '33333333-3333-3333-3333-333333333333');
do $$ begin
  assert (select performed_by_name from public.plant_maintenance_records where id = 'dddddddd-0000-0000-0000-000000000001') = 'Sam Fixer', 'name not trimmed';
  assert (select created_by from public.plant_maintenance_records where id = 'dddddddd-0000-0000-0000-000000000001') = '11111111-1111-1111-1111-111111111111', 'the client chose who recorded it';
  raise notice 'PASS  a supervisor records an inspection naming the competent person, stamped by the database';
end $$;
select tests.expect_error($q$
  insert into public.plant_maintenance_records (plant_id, kind, done_on, performed_by_name)
  values ('cccccccc-0000-0000-0000-000000000001', 'inspection', current_date - 1, '   ')
$q$, 'check constraint');
select tests.expect_error($q$
  insert into public.plant_maintenance_records (plant_id, kind, done_on, performed_by_name)
  values ('cccccccc-0000-0000-0000-000000000001', 'inspection', current_date + 7, 'Future Fred')
$q$, 'in the future');
select tests.expect_error($q$
  insert into public.plant_maintenance_records (plant_id, kind, done_on, performed_by_name, next_due_on)
  values ('cccccccc-0000-0000-0000-000000000001', 'inspection', current_date - 1, 'Sam', current_date - 5)
$q$, 'plant_maintenance_next_after');
update public.plant_maintenance_records set done_on = current_date - 100 where id = 'dddddddd-0000-0000-0000-000000000001';
delete from public.plant_maintenance_records where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ begin
  assert (select done_on from public.plant_maintenance_records where id = 'dddddddd-0000-0000-0000-000000000001') = current_date - 3, 'a record was rewritten or deleted';
  raise notice 'PASS  a record needs a name, is never in the future, and stands';
end $$;

-- s. 42: marked as registrable with no number, the crane is not prestarted. Unmarked plant is untouched.
update public.plant_register set registration_required = true where id = 'cccccccc-0000-0000-0000-000000000002';
select tests.expect_error($q$
  insert into public.plant_prestarts (project_id, plant_id, prestart_date, operator_name, checks, conducted_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', current_date, 'Op', '{}'::jsonb, '11111111-1111-1111-1111-111111111111')
$q$, 'needs registration and none is recorded');
update public.plant_register set registration_no = 'CR-4411', registration_expires_on = current_date - 1 where id = 'cccccccc-0000-0000-0000-000000000002';
select tests.expect_error($q$
  insert into public.plant_prestarts (project_id, plant_id, prestart_date, operator_name, checks, conducted_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', current_date, 'Op', '{}'::jsonb, '11111111-1111-1111-1111-111111111111')
$q$, 'lapsed registration');
do $$ begin raise notice 'PASS  registrable plant with no registration, or a lapsed one, is refused a prestart'; end $$;

-- The PM reads the records; the labourer does not.
reset role;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.plant_maintenance_records) = 1, 'the PM cannot read the plant records';
end $$;
select tests.expect_error($q$
  insert into public.plant_maintenance_records (plant_id, kind, done_on, performed_by_name)
  values ('cccccccc-0000-0000-0000-000000000001', 'maintenance', current_date, 'PM')
$q$, 'row-level security');
reset role;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.plant_maintenance_records) = 0, 'a labourer read the plant records';
  raise notice 'PASS  the PM reads plant records and cannot add one; a labourer reads none';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL PLANT INSPECTION TESTS PASSED'; end $$;
rollback;
