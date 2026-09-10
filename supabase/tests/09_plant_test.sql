-- Plant prestarts: the register is the fleet, a signed inspection is frozen,
-- and only the people who run prestarts may write either.
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
  ('44444444-4444-4444-4444-444444444444', 'outsider@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'pm');

-- The supervisor keeps the register and signs an inspection.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

insert into public.plant_register (id, org_id, name, kind, plant_no, created_by)
values ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '1.8t Excavator', 'excavator', 'KBS-01',
        '11111111-1111-1111-1111-111111111111');

insert into public.plant_prestarts (id, project_id, plant_id, prestart_date, operator_name, hour_meter, checks, fit_for_use, conducted_by)
values ('eeeeeeee-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
        date '2026-09-09', 'Danny Rowe', 1234.5,
        '[{"key":"fuel","label":"Fuel for the day","result":"ok"},{"key":"tracks","label":"Tracks","result":"defect"}]'::jsonb,
        false, '11111111-1111-1111-1111-111111111111');

do $$ begin
  assert (select completed_at from public.plant_prestarts where id = 'eeeeeeee-0000-0000-0000-000000000001') is null,
         'an unsigned prestart is already complete';
end $$;

-- Born signed? No: completed_at and signature_path are dropped on insert.
insert into public.plant_prestarts (id, project_id, plant_id, prestart_date, operator_name, checks, conducted_by, completed_at, signature_path)
values ('eeeeeeee-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
        date '2026-09-09', 'Sam Whitely', '[]'::jsonb, '11111111-1111-1111-1111-111111111111', now(), 'x/y/z.png');
do $$ begin
  assert (select completed_at is null and signature_path is null from public.plant_prestarts where id = 'eeeeeeee-0000-0000-0000-000000000002'),
         'a prestart was born signed';
end $$;
-- Completed by hand? No: completed_at set directly is ignored.
update public.plant_prestarts set completed_at = now() where id = 'eeeeeeee-0000-0000-0000-000000000002';
do $$ begin
  assert (select completed_at from public.plant_prestarts where id = 'eeeeeeee-0000-0000-0000-000000000002') is null,
         'completed_at could be set by hand';
end $$;
-- Signed with no checks answered? Refused.
select tests.expect_error($q$
  update public.plant_prestarts set signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/plant/eeeeeeee-0000-0000-0000-000000000002/sig.png'
   where id = 'eeeeeeee-0000-0000-0000-000000000002'
$q$, 'no checks answered');
-- A signature stored somewhere else? Refused.
select tests.expect_error($q$
  update public.plant_prestarts set checks = '[{"key":"fuel","label":"Fuel","result":"ok"}]'::jsonb,
         signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/plant/eeeeeeee-0000-0000-0000-000000000001/sig.png'
   where id = 'eeeeeeee-0000-0000-0000-000000000002'
$q$, 'own folder');
do $$ begin raise notice 'PASS  a plant prestart is never born signed, cannot be completed by hand, and signs only over real checks'; end $$;

insert into public.plant_defects (id, project_id, plant_id, prestart_id, item_key, item_label, note, raised_by)
values ('ffffffff-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
        'eeeeeeee-0000-0000-0000-000000000001', 'tracks', 'Tracks', 'Left track slack', '11111111-1111-1111-1111-111111111111');

update public.plant_prestarts set signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/plant/eeeeeeee-0000-0000-0000-000000000001/sig.png'
 where id = 'eeeeeeee-0000-0000-0000-000000000001';

-- The defect keeps what it said; closing it is the one change allowed.
select tests.expect_error($q$
  update public.plant_defects set note = 'nothing wrong really' where id = 'ffffffff-0000-0000-0000-000000000001'
$q$, 'keeps what it said');
select tests.expect_error($q$
  insert into public.plant_defects (project_id, plant_id, prestart_id, item_key, item_label, raised_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
          'late', 'Added later', '11111111-1111-1111-1111-111111111111')
$q$, 'cannot be added');
update public.plant_defects set closed_at = now(), closed_by = '11111111-1111-1111-1111-111111111111', closed_note = 'Tensioned'
 where id = 'ffffffff-0000-0000-0000-000000000001';
do $$ begin
  assert (select closed_at from public.plant_defects where id = 'ffffffff-0000-0000-0000-000000000001') is not null, 'a defect could not be closed';
  raise notice 'PASS  a defect of a signed inspection can only be closed';
end $$;

do $$ begin
  assert (select completed_at from public.plant_prestarts where id = 'eeeeeeee-0000-0000-0000-000000000001') is not null,
         'the signature did not complete the prestart';
  raise notice 'PASS  the operator''s signature completes the plant prestart';
end $$;

-- Under RLS a signed row is simply out of reach: the update touches nothing.
update public.plant_prestarts set fit_for_use = true where id = 'eeeeeeee-0000-0000-0000-000000000001';
delete from public.plant_prestarts where id = 'eeeeeeee-0000-0000-0000-000000000001';
do $$ begin
  assert (select fit_for_use from public.plant_prestarts where id = 'eeeeeeee-0000-0000-0000-000000000001') = false,
         'a signed plant prestart was changed through RLS';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

-- And with RLS out of the way (the owner, or a service key), the trigger holds the line.
select tests.expect_error($q$
  update public.plant_prestarts set fit_for_use = true where id = 'eeeeeeee-0000-0000-0000-000000000001'
$q$, 'signed and cannot be modified');
select tests.expect_error($q$
  delete from public.plant_prestarts where id = 'eeeeeeee-0000-0000-0000-000000000001'
$q$, 'signed and cannot be deleted');
do $$ begin raise notice 'PASS  a signed plant prestart is frozen'; end $$;

-- Which of the fleet is on this job: the crew decides.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.project_plant (project_id, plant_id) values ('bbbbbbbb-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001');
do $$ begin
  assert (select active from public.project_plant where project_id = 'bbbbbbbb-0000-0000-0000-000000000001' and plant_id = 'dddddddd-0000-0000-0000-000000000001'),
         'the supervisor could not put a machine on the job';
  raise notice 'PASS  a supervisor puts a machine on the job';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- But not a machine from another organisation.
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000002', 'Someone Else', 'ELS');
insert into public.plant_register (id, org_id, name, kind) values
  ('dddddddd-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000002', 'Their Roller', 'roller');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  insert into public.project_plant (project_id, plant_id)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000099')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  a job carries only its own organisation''s machines'; end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- The PM reads and writes nothing.
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.plant_register) = 1, 'the PM cannot read the register';
  assert (select count(*) from public.plant_prestarts) = 2, 'the PM cannot read plant prestarts';
end $$;
select tests.expect_error($q$
  insert into public.plant_register (org_id, name, kind) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Roller', 'roller')
$q$, 'row-level security');
update public.project_plant set active = false where project_id = 'bbbbbbbb-0000-0000-0000-000000000001';
do $$ begin
  assert (select active from public.project_plant where project_id = 'bbbbbbbb-0000-0000-0000-000000000001' and plant_id = 'dddddddd-0000-0000-0000-000000000001'),
         'a PM took a machine off the job';
end $$;
select tests.expect_error($q$
  insert into public.plant_prestarts (project_id, plant_id, prestart_date, operator_name, conducted_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', date '2026-09-09', 'PM',
          '33333333-3333-3333-3333-333333333333')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  a PM reads plant records and writes none'; end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- An outsider sees nothing.
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.plant_register) = 0, 'an outsider can read the register';
  assert (select count(*) from public.plant_prestarts) = 0, 'an outsider can read plant prestarts';
  raise notice 'PASS  non-members see no plant records';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice ''; raise notice 'ALL PLANT TESTS PASSED'; end $$;
rollback;
