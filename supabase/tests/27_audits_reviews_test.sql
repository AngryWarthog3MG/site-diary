-- Audits and management reviews: independence to issue, frozen once issued, actions done once, and the schedule
-- discharged by the same act.
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
insert into public.obligations (id, org_id, project_id, kind, title, interval_months, first_due_on) values
  ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'internal_audit', 'Audit', 3, current_date - 10),
  ('c0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'management_review', 'Review', 3, current_date - 5);

-- ---------------------------------------------------------------- audit
select tests.expect_error($q$
  insert into public.audits (org_id, project_id, obligation_id, audit_date, scope, criteria, auditor_name)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', current_date, 's', 'c', 'a')
$q$, 'not for this kind');
insert into public.audits (id, org_id, project_id, obligation_id, audit_date, scope, criteria, auditor_name)
values ('d0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        'c0000000-0000-0000-0000-000000000001', current_date - 1, 'Earthworks and drainage', 'ISO 9001:2015; MRWA Spec 201', 'R. Singh');
insert into public.audit_findings (id, audit_id, seq, kind, clause, finding, action, owner_name, due_on)
values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 1, 'minor_nonconformity', '7.1.5', 'Density gauge certificate not on file', 'File the certificate', 'Matt', current_date + 7);
select tests.expect_error($q$
  update public.audits set status = 'issued', summary = 'One minor' where id = 'd0000000-0000-0000-0000-000000000001'
$q$, 'does not deliver the work');
select tests.expect_error($q$
  update public.audits set status = 'issued', auditor_independent = true where id = 'd0000000-0000-0000-0000-000000000001'
$q$, 'summary');
update public.audits set status = 'issued', auditor_independent = true, summary = 'One minor nonconformity', previous_actions_review = 'First audit'
  where id = 'd0000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.obligation_completions where obligation_id = 'c0000000-0000-0000-0000-000000000001') = 1,
    'issuing the audit did not discharge its schedule';
  assert (select due_on from public.obligation_completions where obligation_id = 'c0000000-0000-0000-0000-000000000001') = current_date - 10,
    'the completion was not for the occurrence that was due';
  assert (select done_on from public.obligation_completions where obligation_id = 'c0000000-0000-0000-0000-000000000001') = current_date - 1,
    'the completion was not dated the day of the audit';
  assert (select evidence_ref from public.obligation_completions where obligation_id = 'c0000000-0000-0000-0000-000000000001') = 'audit:d0000000-0000-0000-0000-000000000001',
    'the completion does not point at the audit';
  raise notice 'PASS  an audit issues only with an independent auditor and a summary, and discharges its schedule in the same act';
end $$;
select tests.expect_error($q$
  update public.audits set summary = 'Changed' where id = 'd0000000-0000-0000-0000-000000000001'
$q$, 'frozen');
select tests.expect_error($q$
  update public.audit_findings set finding = 'Softer' where id = 'e0000000-0000-0000-0000-000000000001'
$q$, 'does not change');
select tests.expect_error($q$
  insert into public.audit_findings (audit_id, seq, kind, finding) values ('d0000000-0000-0000-0000-000000000001', 2, 'observation', 'Late addition')
$q$, 'while the report is a draft');
update public.audit_findings set done_at = '2000-01-01', done_note = 'Certificate filed' where id = 'e0000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select done_at from public.audit_findings where id = 'e0000000-0000-0000-0000-000000000001') > now() - interval '1 minute', 'done time was the client''s';
end $$;
select tests.expect_error($q$
  update public.audit_findings set done_note = 'Rewritten' where id = 'e0000000-0000-0000-0000-000000000001'
$q$, 'frozen');
do $$ begin raise notice 'PASS  an issued report and its findings stand; an action is marked done once, stamped by the database'; end $$;

-- ---------------------------------------------------------------- management review
insert into public.management_reviews (id, org_id, project_id, obligation_id, held_on, attendees, inputs, outputs)
values ('f0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        'c0000000-0000-0000-0000-000000000002', current_date, 'Mitchell, Matt', 'Audit results; NCR trends', 'Buy a second gauge');
insert into public.review_actions (id, review_id, action, owner_name, due_on)
values ('a0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'Buy a second density gauge', 'Mitchell', current_date + 30);
update public.management_reviews set status = 'issued' where id = 'f0000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.obligation_completions where obligation_id = 'c0000000-0000-0000-0000-000000000002') = 1,
    'issuing the review did not discharge its schedule';
end $$;
select tests.expect_error($q$
  update public.review_actions set due_on = current_date + 90 where id = 'a0000000-0000-0000-0000-000000000001'
$q$, 'carried forward');
update public.review_actions set done_at = now(), done_note = 'Ordered' where id = 'a0000000-0000-0000-0000-000000000001';
select tests.expect_error($q$
  update public.review_actions set done_note = 'Changed' where id = 'a0000000-0000-0000-0000-000000000001'
$q$, 'frozen');
select tests.expect_error($q$
  delete from public.review_actions where id = 'a0000000-0000-0000-0000-000000000001'
$q$, 'never removed');
do $$ begin raise notice 'PASS  a review discharges its schedule, and its actions are carried forward unchanged until done'; end $$;

-- A leading hand reads; a labourer does not.
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.audits) = 1 and (select count(*) from public.management_reviews) = 1, 'a leading hand cannot read audits and reviews';
end $$;
select tests.expect_error($q$
  insert into public.audits (org_id, project_id, audit_date, scope, criteria, auditor_name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', current_date, 's', 'c', 'a')
$q$, 'row-level security');
reset role;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.audits) = 0 and (select count(*) from public.audit_findings) = 0
     and (select count(*) from public.management_reviews) = 0 and (select count(*) from public.review_actions) = 0, 'a labourer read audits or reviews';
  raise notice 'PASS  a leading hand reads audits and reviews without writing them; a labourer reads none';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL AUDIT AND REVIEW TESTS PASSED'; end $$;
rollback;
