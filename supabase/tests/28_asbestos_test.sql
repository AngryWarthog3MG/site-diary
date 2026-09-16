-- Asbestos: registers received or held, all three limbs before "not required", superseded never rewritten, the crew
-- briefed on the register in force, and removal notified five days ahead under the right licence.
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
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'leading_hand'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'labourer');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

select tests.expect_error($q$
  insert into public.asbestos_registers (project_id, status, duty_holder, register_date, built_after_2003, none_identified, none_likely)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'not_required', 'Us', current_date, true, true, false)
$q$, 'asbestos_not_required_all_limbs');
insert into public.asbestos_registers (id, project_id, status, duty_holder, register_date, summary, asbestos_present, plan_file_path, plan_date)
values ('c0000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'received', '  Curtin University Facilities ', current_date - 30,
        'Bonded AC sheeting in the old plant room eaves', true, 'bbbbbbbb-0000-0000-0000-000000000001/c0000000-0000-0000-0000-000000000001/plan.pdf', current_date - 30);
select tests.expect_error($q$
  insert into public.asbestos_registers (project_id, status, duty_holder, register_date, plan_file_path)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'own', 'Us', current_date, 'x/plan.pdf')
$q$, 'asbestos_plan_needs_date');
select tests.expect_error($q$
  update public.asbestos_registers set summary = 'Nothing here' where id = 'c0000000-0000-0000-0000-000000000001'
$q$, 'superseded by a newer one');
do $$ begin
  assert (select duty_holder from public.asbestos_registers where id = 'c0000000-0000-0000-0000-000000000001') = 'Curtin University Facilities', 'duty holder not trimmed';
  raise notice 'PASS  a received register names its duty holder, needs all three limbs to be "not required", and is not rewritten';
end $$;

-- The leading hand briefs the crew; once per person per register.
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
insert into public.asbestos_acknowledgements (register_id, person_name, briefed_on) values ('c0000000-0000-0000-0000-000000000001', 'Evan  Burke', current_date);
select tests.expect_error($q$
  insert into public.asbestos_acknowledgements (register_id, person_name, briefed_on) values ('c0000000-0000-0000-0000-000000000001', 'evan burke', current_date)
$q$, 'duplicate key');
select tests.expect_error($q$
  insert into public.asbestos_registers (project_id, status, duty_holder, register_date) values ('bbbbbbbb-0000-0000-0000-000000000001', 'own', 'Us', current_date)
$q$, 'row-level security');

-- A newer register supersedes; the crew are briefed on the one in force only.
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.asbestos_registers (id, project_id, status, duty_holder, register_date, summary, asbestos_present)
values ('c0000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'received', 'Curtin University Facilities', current_date, 'Eaves sheeting removed; none remaining', false);
update public.asbestos_registers set superseded_by = 'c0000000-0000-0000-0000-000000000002' where id = 'c0000000-0000-0000-0000-000000000001';
select tests.expect_error($q$
  update public.asbestos_registers set superseded_by = null where id = 'c0000000-0000-0000-0000-000000000001'
$q$, 'frozen');
select tests.expect_error($q$
  insert into public.asbestos_acknowledgements (register_id, person_name, briefed_on) values ('c0000000-0000-0000-0000-000000000001', 'Marcus', current_date)
$q$, 'register in force');
do $$ begin raise notice 'PASS  the crew are briefed once each, on the register in force, and a superseded register is frozen'; end $$;

-- Removal: five days notice, Class A for friable.
insert into public.asbestos_removals (project_id, location, friable, area_m2, removalist, licence_class, licence_no, notified_worksafe_on, work_start_on)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'Plant room eaves', false, 24, 'Safe Removals Pty Ltd', 'B', 'ASB-B-123', current_date - 10, current_date - 3);
select tests.expect_error($q$
  insert into public.asbestos_removals (project_id, location, friable, area_m2, removalist, licence_class, licence_no, notified_worksafe_on, work_start_on)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Pipe lagging', false, 30, 'X', 'B', 'L', current_date - 4, current_date)
$q$, 'asbestos_removal_notice');
select tests.expect_error($q$
  insert into public.asbestos_removals (project_id, location, friable, area_m2, removalist, licence_class, licence_no, emergency, notified_worksafe_on, work_start_on)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Pipe lagging', true, 2, 'X', 'B', 'L', true, current_date, current_date)
$q$, 'asbestos_removal_friable_class_a');
insert into public.asbestos_removals (project_id, location, friable, area_m2, removalist, licence_class, licence_no, emergency, notified_worksafe_on, work_start_on)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'Storm-damaged lagging', true, 2, 'Safe Removals Pty Ltd', 'A', 'ASB-A-9', true, current_date, current_date);
do $$ begin raise notice 'PASS  a removal is notified five days ahead unless an emergency, and friable is Class A'; end $$;

-- The labourer reads the register (it is kept accessible to workers) but not the removal records.
reset role;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.asbestos_registers) = 2, 'a labourer cannot read the asbestos register';
  assert (select count(*) from public.asbestos_removals) = 0, 'a labourer read the removal records';
  raise notice 'PASS  a labourer reads the register and not the removal records';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL ASBESTOS TESTS PASSED'; end $$;
rollback;
