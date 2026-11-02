-- The action register (README R177): manual actions, assignee and priority on every origin, one view over all six,
-- and the assignee of an action of any origin may close it.
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

-- A supervisor, a leading hand, a labourer and an admin, on one job; an outsider on another company's job.
insert into auth.users (id, email) values
  ('11111111-ac00-0000-0000-000000000001', 'sup.actions@example.com'),
  ('11111111-ac00-0000-0000-000000000002', 'lh.actions@example.com'),
  ('11111111-ac00-0000-0000-000000000003', 'lab.actions@example.com'),
  ('11111111-ac00-0000-0000-000000000004', 'admin.actions@example.com'),
  ('11111111-ac00-0000-0000-000000000009', 'outsider.actions@example.com');
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-ac00-0000-0000-000000000001', 'Action Civil', 'ACT'),
  ('aaaaaaaa-ac00-0000-0000-000000000002', 'Other Civil', 'OTH');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-ac00-0000-0000-000000000001', 'aaaaaaaa-ac00-0000-0000-000000000001', 'Action Job', 'A401'),
  ('bbbbbbbb-ac00-0000-0000-000000000002', 'aaaaaaaa-ac00-0000-0000-000000000002', 'Other Job', 'O401');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-ac00-0000-0000-000000000001', '11111111-ac00-0000-0000-000000000001', 'supervisor'),
  ('bbbbbbbb-ac00-0000-0000-000000000001', '11111111-ac00-0000-0000-000000000002', 'leading_hand'),
  ('bbbbbbbb-ac00-0000-0000-000000000001', '11111111-ac00-0000-0000-000000000003', 'labourer'),
  ('bbbbbbbb-ac00-0000-0000-000000000001', '11111111-ac00-0000-0000-000000000004', 'admin'),
  ('bbbbbbbb-ac00-0000-0000-000000000002', '11111111-ac00-0000-0000-000000000009', 'supervisor');
-- An incident on the job, with one corrective action, raised as the supervisor.
insert into public.incidents (id, project_id, kind, occurred_at, description, reported_by, status)
  values ('cccccccc-ac00-0000-0000-000000000001', 'bbbbbbbb-ac00-0000-0000-000000000001', 'hazard', '2026-11-01T01:00:00Z', 'Loose kerb', '11111111-ac00-0000-0000-000000000001', 'open');
insert into public.incident_actions (id, incident_id, action, due_on, created_by)
  values ('dddddddd-ac00-0000-0000-000000000001', 'cccccccc-ac00-0000-0000-000000000001', 'Fix the kerb', '2026-11-05', '11111111-ac00-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-ac00-0000-0000-000000000001","role":"authenticated"}';

-- 1. The supervisor raises a manual action on the job, assigned to the leading hand; the DB stamps who and when.
insert into public.actions (id, org_id, project_id, action, priority, assigned_to, due_on, raised_by) values
  ('eeeeeeee-ac00-0000-0000-000000000001', 'aaaaaaaa-ac00-0000-0000-000000000001', 'bbbbbbbb-ac00-0000-0000-000000000001',
   '  Order the signs  ', 'high', '11111111-ac00-0000-0000-000000000002', '2026-11-03', '11111111-ac00-0000-0000-000000000004');
do $$ declare r record; begin
  select * into r from public.actions where id = 'eeeeeeee-ac00-0000-0000-000000000001';
  if r.action <> 'Order the signs' or r.raised_by <> '11111111-ac00-0000-0000-000000000001' or r.assigned_at is null or r.done_at is not null then
    raise exception 'TESTFAIL: the raiser is the caller, the assignment is stamped, the action is open';
  end if;
end; $$;
-- 2. Assigned to someone on the job only.
select tests.expect_error($$ insert into public.actions (org_id, project_id, action, assigned_to, raised_by) values
  ('aaaaaaaa-ac00-0000-0000-000000000001', 'bbbbbbbb-ac00-0000-0000-000000000001', 'x', '11111111-ac00-0000-0000-000000000009', '11111111-ac00-0000-0000-000000000001') $$, 'someone on the job');
-- 3. A job of another company is refused.
select tests.expect_error($$ insert into public.actions (org_id, project_id, action, raised_by) values
  ('aaaaaaaa-ac00-0000-0000-000000000001', 'bbbbbbbb-ac00-0000-0000-000000000002', 'x', '11111111-ac00-0000-0000-000000000001') $$, 'not in this organisation');
-- 4. A supervisor does not raise a company-wide action (that is the office's: app.can_manage_crew — a supervisor is in it; a leading hand is not).
set local request.jwt.claims = '{"sub":"11111111-ac00-0000-0000-000000000002","role":"authenticated"}';
select tests.expect_error($$ insert into public.actions (org_id, project_id, action, raised_by) values
  ('aaaaaaaa-ac00-0000-0000-000000000001', null, 'Company-wide by a leading hand', '11111111-ac00-0000-0000-000000000002') $$, 'row-level security');
-- 5. The leading hand raises one on the job (runs the site), and reads the register.
insert into public.actions (id, org_id, project_id, action, raised_by) values
  ('eeeeeeee-ac00-0000-0000-000000000002', 'aaaaaaaa-ac00-0000-0000-000000000001', 'bbbbbbbb-ac00-0000-0000-000000000001', 'Tidy the laydown', '11111111-ac00-0000-0000-000000000002');
do $$ declare n integer; begin
  select count(*) into n from public.action_register where project_id = 'bbbbbbbb-ac00-0000-0000-000000000001';
  if n <> 3 then raise exception 'TESTFAIL: the register shows two manual actions and the incident''s one, got %', n; end if;
  select count(*) into n from public.action_register where origin = 'incident' and record_ref = 'INC-001' and action = 'Fix the kerb';
  if n <> 1 then raise exception 'TESTFAIL: the incident''s action carries its reference'; end if;
end; $$;
-- 6. The leading hand gives the incident's action to themselves at high priority through update_action — the
--    incident's own policy lets a leading hand update it? No: managers only. The register says so.
select tests.expect_error($$ select public.update_action('incident', 'dddddddd-ac00-0000-0000-000000000001', '11111111-ac00-0000-0000-000000000002', 'high', '2026-11-05', null) $$, 'not on the file');
-- 7. The supervisor can, and the assignee is then the leading hand.
set local request.jwt.claims = '{"sub":"11111111-ac00-0000-0000-000000000001","role":"authenticated"}';
select public.update_action('incident', 'dddddddd-ac00-0000-0000-000000000001', '11111111-ac00-0000-0000-000000000002', 'critical', '2026-11-04', 'LH');
do $$ declare r record; begin
  select * into r from public.action_register where origin = 'incident' and id = 'dddddddd-ac00-0000-0000-000000000001';
  if r.assigned_to <> '11111111-ac00-0000-0000-000000000002' or r.priority <> 'critical' or r.due_on <> '2026-11-04' then
    raise exception 'TESTFAIL: assignment, priority and due date move through update_action';
  end if;
end; $$;
-- 8. Not to an outsider.
select tests.expect_error($$ select public.update_action('incident', 'dddddddd-ac00-0000-0000-000000000001', '11111111-ac00-0000-0000-000000000009', 'normal', null, null) $$, 'someone on the job');
-- 9. Priority is one of three.
select tests.expect_error($$ select public.update_action('manual', 'eeeeeeee-ac00-0000-0000-000000000001', null, 'urgent', null, null) $$, 'normal, high or critical');
-- 10. The ASSIGNEE closes the incident's action, though the incident's own policy would not let a leading hand touch it.
set local request.jwt.claims = '{"sub":"11111111-ac00-0000-0000-000000000002","role":"authenticated"}';
select public.complete_action('incident', 'dddddddd-ac00-0000-0000-000000000001', 'Kerb reset and grouted');
do $$ declare r record; begin
  select * into r from public.incident_actions where id = 'dddddddd-ac00-0000-0000-000000000001';
  if r.done_at is null or r.done_by <> '11111111-ac00-0000-0000-000000000002' or r.done_note <> 'Kerb reset and grouted' then
    raise exception 'TESTFAIL: the assignee closes it and the DB stamps who';
  end if;
end; $$;
-- 11. Done is frozen, through the register too.
select tests.expect_error($$ select public.update_action('incident', 'dddddddd-ac00-0000-0000-000000000001', null, 'normal', null, null) $$, 'not on the file');
set local request.jwt.claims = '{"sub":"11111111-ac00-0000-0000-000000000001","role":"authenticated"}';
select tests.expect_error($$ update public.incident_actions set priority = 'normal' where id = 'dddddddd-ac00-0000-0000-000000000001' $$, 'frozen');
-- 12. The assignee of a manual action closes it; the raiser may change an open one; a done one is frozen and never removed.
set local request.jwt.claims = '{"sub":"11111111-ac00-0000-0000-000000000002","role":"authenticated"}';
select public.complete_action('manual', 'eeeeeeee-ac00-0000-0000-000000000001', 'Signs ordered');
-- (Under RLS a done row is simply not updatable, so the trigger is proven as the service role, where only it stands.)
reset role;
select tests.expect_error($$ update public.actions set action = 'Changed' where id = 'eeeeeeee-ac00-0000-0000-000000000001' $$, 'frozen');
select tests.expect_error($$ delete from public.actions where id = 'eeeeeeee-ac00-0000-0000-000000000001' $$, 'not removed');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-ac00-0000-0000-000000000001","role":"authenticated"}';
-- 13. The leading hand removes the open action they raised; the supervisor cannot remove it (not theirs) — it just is not deleted.
do $$ declare n integer; begin
  delete from public.actions where id = 'eeeeeeee-ac00-0000-0000-000000000002';
  select count(*) into n from public.actions where id = 'eeeeeeee-ac00-0000-0000-000000000002';
  if n <> 1 then raise exception 'TESTFAIL: only the raiser removes an open action'; end if;
end; $$;
set local request.jwt.claims = '{"sub":"11111111-ac00-0000-0000-000000000002","role":"authenticated"}';
delete from public.actions where id = 'eeeeeeee-ac00-0000-0000-000000000002';
do $$ declare n integer; begin
  select count(*) into n from public.actions where id = 'eeeeeeee-ac00-0000-0000-000000000002';
  if n <> 0 then raise exception 'TESTFAIL: the raiser removes their own open action'; end if;
end; $$;
-- 14. The admin raises a company-wide action (no job) and the job's supervisor reads it; it does not move jobs.
set local request.jwt.claims = '{"sub":"11111111-ac00-0000-0000-000000000004","role":"authenticated"}';
insert into public.actions (id, org_id, project_id, action, raised_by) values
  ('eeeeeeee-ac00-0000-0000-000000000003', 'aaaaaaaa-ac00-0000-0000-000000000001', null, 'Renew the public liability policy', '11111111-ac00-0000-0000-000000000004');
select tests.expect_error($$ update public.actions set project_id = 'bbbbbbbb-ac00-0000-0000-000000000001' where id = 'eeeeeeee-ac00-0000-0000-000000000003' $$, 'stays where it was raised');
set local request.jwt.claims = '{"sub":"11111111-ac00-0000-0000-000000000001","role":"authenticated"}';
do $$ declare n integer; begin
  select count(*) into n from public.action_register where origin = 'manual' and project_id is null and org_id = 'aaaaaaaa-ac00-0000-0000-000000000001';
  if n <> 1 then raise exception 'TESTFAIL: a company-wide action is on every job''s register'; end if;
end; $$;
-- 15. The labourer reads none of it; the outsider reads none of it.
set local request.jwt.claims = '{"sub":"11111111-ac00-0000-0000-000000000003","role":"authenticated"}';
do $$ declare n integer; begin
  select count(*) into n from public.action_register;
  if n <> 0 then raise exception 'TESTFAIL: the labourer reads no action'; end if;
end; $$;
select tests.expect_error($$ insert into public.actions (org_id, project_id, action, raised_by) values
  ('aaaaaaaa-ac00-0000-0000-000000000001', 'bbbbbbbb-ac00-0000-0000-000000000001', 'x', '11111111-ac00-0000-0000-000000000003') $$, 'row-level security');
set local request.jwt.claims = '{"sub":"11111111-ac00-0000-0000-000000000009","role":"authenticated"}';
do $$ declare n integer; begin
  select count(*) into n from public.action_register;
  if n <> 0 then raise exception 'TESTFAIL: another company reads none of it'; end if;
end; $$;

rollback;
