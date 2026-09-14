-- Subcontractors: one company per organisation, documents retired not
-- rewritten or removed, engagement per job, managers write and members read.
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
  ('33333333-3333-3333-3333-333333333333', 'pm@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'leading_hand'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'pm');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.subcontractors (id, org_id, name, abn, created_by)
values ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '  Whitely   Plumbing ', '12 345 678 901', '11111111-1111-1111-1111-111111111111');
do $$ declare s public.subcontractors; begin
  select * into s from public.subcontractors where id = 'dddddddd-0000-0000-0000-000000000001';
  assert s.name = 'Whitely Plumbing' and s.abn = '12345678901', 'name or ABN not normalised';
end $$;
select tests.expect_error($q$
  insert into public.subcontractors (org_id, name, created_by) values ('aaaaaaaa-0000-0000-0000-000000000001', 'whitely plumbing', '11111111-1111-1111-1111-111111111111')
$q$, 'subcontractors_org_name_idx');
do $$ begin raise notice 'PASS  one company per organisation, however it was typed'; end $$;

insert into public.subcontractor_documents (id, subcontractor_id, kind, title, issued_on, expires_on, created_by)
values ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'public_liability', 'CGU policy', date '2026-01-01', date '2027-01-01', '11111111-1111-1111-1111-111111111111');
select tests.expect_error($q$
  insert into public.subcontractor_documents (subcontractor_id, kind, title, issued_on, expires_on, created_by)
  values ('dddddddd-0000-0000-0000-000000000001', 'workers_comp', 'Backwards', date '2027-01-01', date '2026-01-01', '11111111-1111-1111-1111-111111111111')
$q$, 'subcontractor_documents_dates');
select tests.expect_error($q$
  update public.subcontractor_documents set expires_on = date '2030-01-01' where id = 'eeeeeeee-0000-0000-0000-000000000001'
$q$, 'retired and replaced');
update public.subcontractor_documents set active = false where id = 'eeeeeeee-0000-0000-0000-000000000001';
reset role;
select tests.expect_error($q$
  delete from public.subcontractor_documents where id = 'eeeeeeee-0000-0000-0000-000000000001'
$q$, 'never changed or removed');
do $$ begin
  assert (select active from public.subcontractor_documents where id = 'eeeeeeee-0000-0000-0000-000000000001') = false, 'retire failed';
  raise notice 'PASS  a document is retired, never rewritten or removed';
end $$;

-- A retired document stays retired; another organisation's subcontractor cannot be engaged.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  update public.subcontractor_documents set active = true where id = 'eeeeeeee-0000-0000-0000-000000000001'
$q$, 'stays retired');
reset role;
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000002', 'Other Co', 'OTH');
insert into public.subcontractors (id, org_id, name) values ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Foreign Sub');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  insert into public.project_subcontractors (project_id, subcontractor_id, created_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111')
$q$, 'own organisation');
do $$ begin raise notice 'PASS  retired stays retired; a job engages only its own organisation''s subcontractors'; end $$;
reset role;

-- Engagement on the job by a manager; the leading hand reads and does not write.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.project_subcontractors (project_id, subcontractor_id, scope, created_by)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'Water main', '11111111-1111-1111-1111-111111111111');
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.subcontractors) = 1, 'a leading hand cannot read the subcontractor list';
  assert (select count(*) from public.project_subcontractors) = 1, 'a leading hand cannot see who is engaged';
end $$;
select tests.expect_error($q$
  insert into public.subcontractors (org_id, name, created_by) values ('aaaaaaaa-0000-0000-0000-000000000001', 'LH Co', '22222222-2222-2222-2222-222222222222')
$q$, 'row-level security');
select tests.expect_error($q$
  insert into public.subcontractor_documents (subcontractor_id, kind, title, created_by)
  values ('dddddddd-0000-0000-0000-000000000001', 'swms', 'LH doc', '22222222-2222-2222-2222-222222222222')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  members read; managers write'; end $$;
reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice 'ALL SUBCONTRACTOR TESTS PASSED'; end $$;
rollback;
