-- A labourer reads only the reports they made: the report, its updates, its actions and its photos. Another labourer
-- on the same job reads none of them; a supervisor reads them all.
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
  ('55555555-5555-5555-5555-555555555555', 'lab.a@example.com'),
  ('56555555-5555-5555-5555-555555555555', 'lab.b@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Test Subbie Civil', 'TSC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Curtin', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'labourer'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '56555555-5555-5555-5555-555555555555', 'labourer');

insert into public.incidents (id, project_id, kind, occurred_at, description, reported_by) values
  ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'hazard', now() - interval '2 hours', 'Loose grate', '55555555-5555-5555-5555-555555555555'),
  ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'injury', now() - interval '1 hour', 'Cut hand on steel', '11111111-1111-1111-1111-111111111111');
insert into public.incident_updates (incident_id, body, created_by) values
  ('dddddddd-0000-0000-0000-000000000001', 'Coned off', '55555555-5555-5555-5555-555555555555'),
  ('dddddddd-0000-0000-0000-000000000002', 'Went to the clinic', '11111111-1111-1111-1111-111111111111');
insert into public.incident_actions (incident_id, action, created_by) values
  ('dddddddd-0000-0000-0000-000000000001', 'Replace the grate', '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-0000-0000-0000-000000000002', 'Gloves briefing', '11111111-1111-1111-1111-111111111111');
insert into storage.objects (bucket_id, name) values
  ('entry-photos', 'bbbbbbbb-0000-0000-0000-000000000001/incident/dddddddd-0000-0000-0000-000000000001/grate.jpg'),
  ('entry-photos', 'bbbbbbbb-0000-0000-0000-000000000001/incident/dddddddd-0000-0000-0000-000000000002/hand.jpg'),
  ('entry-photos', 'bbbbbbbb-0000-0000-0000-000000000001/incident/not-a-uuid/x.jpg');

-- Labourer A: their own report, its update, action and photo; nothing of the injury.
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.incidents) = 1, 'labourer A does not read exactly their own report';
  assert (select id from public.incidents) = 'dddddddd-0000-0000-0000-000000000001', 'labourer A read the wrong report';
  assert (select count(*) from public.incident_updates) = 1, 'labourer A read another report''s updates';
  assert (select count(*) from public.incident_actions) = 1, 'labourer A read another report''s actions';
  assert (select count(*) from storage.objects where bucket_id = 'entry-photos') = 1, 'labourer A read another report''s photo, or lost their own';
  raise notice 'PASS  a labourer reads their own report, its updates, actions and photo — nothing else';
end $$;

-- Labourer B, on the same job: none of it.
reset role;
select set_config('request.jwt.claims', '{"sub":"56555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.incidents) = 0, 'labourer B read someone else''s report';
  assert (select count(*) from public.incident_updates) = 0, 'labourer B read updates';
  assert (select count(*) from public.incident_actions) = 0, 'labourer B read actions';
  assert (select count(*) from storage.objects where bucket_id = 'entry-photos') = 0, 'labourer B read a photo';
  raise notice 'PASS  another labourer on the job reads none of it';
end $$;

-- The supervisor: everything, the odd folder included.
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.incidents) = 2, 'the supervisor lost a report';
  assert (select count(*) from public.incident_updates) = 2, 'the supervisor lost an update';
  assert (select count(*) from public.incident_actions) = 2, 'the supervisor lost an action';
  assert (select count(*) from storage.objects where bucket_id = 'entry-photos') = 3, 'the supervisor lost a photo';
  raise notice 'PASS  a supervisor still reads every report and photo';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL LABOURER OWN-REPORT TESTS PASSED'; end $$;
rollback;
