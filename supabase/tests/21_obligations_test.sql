-- Scheduled obligations: who sets them, who marks them done, and that a completion is evidence.
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
  ('33333333-3333-3333-3333-333333333333', 'pm@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'lab@example.com');
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Somebody Else', 'SE');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Theirs', 'X001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'leading_hand'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'pm'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'labourer');

-- The supervisor sets the job's audit schedule.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.obligations (id, org_id, project_id, kind, title, basis, interval_months, first_due_on, created_by)
values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        'internal_audit', 'Internal audit of this job', 'ISO 9001 cl. 9.2', 3, '2026-06-01', '11111111-1111-1111-1111-111111111111');

-- A job from another company cannot be scheduled under this one.
select tests.expect_error($q$
  insert into public.obligations (org_id, project_id, kind, title, first_due_on)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'other', 'Sneaky', '2026-06-01')
$q$, 'not in this organisation');

-- Marked done: the database stamps who did it, whatever the client sends.
insert into public.obligation_completions (id, obligation_id, due_on, done_on, done_by, evidence_note)
values ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', '2026-06-01', '2026-06-04',
        '33333333-3333-3333-3333-333333333333', '  Audit by R. Singh, 4 findings  ');
do $$ begin
  assert (select done_by from public.obligation_completions where id = 'dddddddd-0000-0000-0000-000000000001') = '11111111-1111-1111-1111-111111111111',
    'the client chose who did it';
  assert (select evidence_note from public.obligation_completions where id = 'dddddddd-0000-0000-0000-000000000001') = 'Audit by R. Singh, 4 findings',
    'the evidence note was not trimmed';
  raise notice 'PASS  a supervisor sets a schedule and marks it done, stamped by the database';
end $$;

-- A completion needs evidence, and cannot be done in the future.
select tests.expect_error($q$
  insert into public.obligation_completions (obligation_id, due_on, done_on, evidence_note)
  values ('cccccccc-0000-0000-0000-000000000001', '2026-09-04', '2026-09-04', '   ')
$q$, 'check constraint');
select tests.expect_error($q$
  insert into public.obligation_completions (obligation_id, due_on, done_on, evidence_note)
  values ('cccccccc-0000-0000-0000-000000000001', '2099-01-01', '2099-01-01', 'Done, honest')
$q$, 'in the future');

-- Evidence is frozen: an update or delete reaches no row it may touch, and the value stands.
update public.obligation_completions set done_on = '2026-06-01' where id = 'dddddddd-0000-0000-0000-000000000001';
delete from public.obligation_completions where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ begin
  assert (select done_on from public.obligation_completions where id = 'dddddddd-0000-0000-0000-000000000001') = '2026-06-04',
    'a completion was rewritten or deleted';
  raise notice 'PASS  a completion needs evidence, is never in the future, and is never rewritten';
end $$;

-- An obligation cannot move to another job.
select tests.expect_error($q$
  update public.obligations set project_id = null where id = 'cccccccc-0000-0000-0000-000000000001'
$q$, 'cannot move');

-- Retiring is allowed.
update public.obligations set active = false where id = 'cccccccc-0000-0000-0000-000000000001';
update public.obligations set active = true where id = 'cccccccc-0000-0000-0000-000000000001';

-- The leading hand reads the schedule but does not set or discharge it.
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.obligations) = 1, 'a leading hand cannot read the schedule';
  assert (select count(*) from public.obligation_completions) = 1, 'a leading hand cannot read the evidence';
end $$;
select tests.expect_error($q$
  insert into public.obligation_completions (obligation_id, due_on, done_on, evidence_note)
  values ('cccccccc-0000-0000-0000-000000000001', '2026-09-04', '2026-09-04', 'Done')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  a leading hand reads the schedule and cannot mark it done'; end $$;

-- The PM reads it.
reset role;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.obligations) = 1, 'the PM cannot read the schedule';
  raise notice 'PASS  the PM reads the schedule';
end $$;

-- The labourer reads none of it: this is management information, not one of their doors.
reset role;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.obligations) = 0, 'a labourer read the audit schedule';
  assert (select count(*) from public.obligation_completions) = 0, 'a labourer read the evidence';
  raise notice 'PASS  a labourer reads no schedules';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL OBLIGATIONS TESTS PASSED'; end $$;
rollback;
