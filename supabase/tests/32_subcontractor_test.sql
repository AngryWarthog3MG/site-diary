-- Working as a subcontractor: incidents told to the head contractor (frozen, by the crew who run the day), the head
-- contractor's plans received and superseded but never rewritten, SWMS submitted and accepted or returned with reasons,
-- and the labourer reading none of it.
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
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Test Subbie Civil', 'TSC');
insert into public.projects (id, org_id, name, code, principal_contractor) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Curtin', 'C001', 'Lendlease');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'leading_hand'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'labourer');
insert into public.incidents (id, project_id, kind, occurred_at, description, reported_by) values
  ('f0000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'near_miss', now() - interval '2 hours', 'Excavator swung near a pedestrian', '22222222-2222-2222-2222-222222222222');
insert into public.swms (id, project_id, kind, title, prepared_by, steps, created_by)
values ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'swms', 'Trench for irrigation main', 'Matty',
        '[{"step":"Dig","hazards":"Collapse","controls":"Batter"}]'::jsonb, '11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------- incident told to the head contractor
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  insert into public.incident_notices (incident_id, notified_at, method, told_by_name) values ('f0000000-0000-0000-0000-000000000001', now() + interval '1 hour', 'phone', 'Evan')
$q$, 'future');
select tests.expect_error($q$
  insert into public.incident_notices (incident_id, notified_at, method, told_by_name) values ('f0000000-0000-0000-0000-000000000001', now(), 'phone', '  ')
$q$, 'check constraint');
insert into public.incident_notices (id, incident_id, notified_at, method, told_by_name, recipient_name, reference)
values ('e1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', now() - interval '90 minutes', 'their_system', ' Evan Burke ', 'Lendlease HSE', ' LL-4471 ');
update public.incident_notices set reference = 'changed';
delete from public.incident_notices;
reset role;
do $$ begin
  assert (select reference from public.incident_notices where id = 'e1000000-0000-0000-0000-000000000001') = 'LL-4471', 'a notice was changed or not trimmed';
  assert (select created_by from public.incident_notices where id = 'e1000000-0000-0000-0000-000000000001') = '22222222-2222-2222-2222-222222222222', 'who recorded it not stamped';
  raise notice 'PASS  a leading hand records telling the head contractor; it is stamped and frozen';
end $$;

-- ---------------------------------------------------------------- head contractor plans
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  insert into public.head_contractor_documents (project_id, kind, title, received_on) values ('bbbbbbbb-0000-0000-0000-000000000001', 'site_rules', 'Rules', current_date)
$q$, 'row-level security');
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  insert into public.head_contractor_documents (project_id, kind, title, received_on) values ('bbbbbbbb-0000-0000-0000-000000000001', 'whs_management_plan', 'Plan', current_date + 3)
$q$, 'once it is received');
select tests.expect_error($q$
  insert into public.head_contractor_documents (project_id, kind, title, received_on, file_path) values ('bbbbbbbb-0000-0000-0000-000000000001', 'whs_management_plan', 'Plan', current_date, 'cccccccc-0000-0000-0000-000000000009/x.pdf')
$q$, 'this job');
insert into public.head_contractor_documents (id, project_id, kind, title, revision, received_on) values
  ('a2000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'whs_management_plan', 'Lendlease Site WHS Management Plan', 'Rev B', current_date - 20),
  ('a2000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'whs_management_plan', 'Lendlease Site WHS Management Plan', 'Rev C', current_date - 1),
  ('a2000000-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'site_rules', 'Site rules', null, current_date - 20);
select tests.expect_error($q$
  update public.head_contractor_documents set revision = 'Rev Z' where id = 'a2000000-0000-0000-0000-000000000001'
$q$, 'does not change');
select tests.expect_error($q$
  update public.head_contractor_documents set superseded_by = 'a2000000-0000-0000-0000-000000000003' where id = 'a2000000-0000-0000-0000-000000000001'
$q$, 'same plan');
update public.head_contractor_documents set superseded_by = 'a2000000-0000-0000-0000-000000000002' where id = 'a2000000-0000-0000-0000-000000000001';
select tests.expect_error($q$
  update public.head_contractor_documents set superseded_by = null where id = 'a2000000-0000-0000-0000-000000000001'
$q$, 'frozen');
do $$ begin raise notice 'PASS  the head contractor''s plans: received by supervisors, never rewritten, superseded once by a newer copy of the same plan'; end $$;

-- ---------------------------------------------------------------- SWMS to the head contractor
select tests.expect_error($q$
  insert into public.swms_reviews (swms_id, kind, happened_on) values ('dddddddd-0000-0000-0000-000000000001', 'accepted', current_date)
$q$, 'submitted first');
insert into public.swms_reviews (swms_id, kind, happened_on, person_name) values ('dddddddd-0000-0000-0000-000000000001', 'submitted', current_date - 2, 'Lendlease site manager');
select tests.expect_error($q$
  insert into public.swms_reviews (swms_id, kind, happened_on) values ('dddddddd-0000-0000-0000-000000000001', 'returned', current_date)
$q$, 'swms_review_returned_says_why');
insert into public.swms_reviews (swms_id, kind, happened_on, comments) values ('dddddddd-0000-0000-0000-000000000001', 'returned', current_date - 1, 'Add exclusion zone for the excavator');
insert into public.swms_reviews (swms_id, kind, happened_on) values ('dddddddd-0000-0000-0000-000000000001', 'submitted', current_date);
insert into public.swms_reviews (swms_id, kind, happened_on, person_name) values ('dddddddd-0000-0000-0000-000000000001', 'accepted', current_date, 'J. Smith');
do $$ begin
  assert (select count(*) from public.swms_reviews where swms_id = 'dddddddd-0000-0000-0000-000000000001') = 4, 'the review trail is incomplete';
  raise notice 'PASS  a SWMS is submitted, returned with a reason, resubmitted and accepted';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  insert into public.swms_reviews (swms_id, kind, happened_on) values ('dddddddd-0000-0000-0000-000000000001', 'submitted', current_date)
$q$, 'row-level security');

-- ---------------------------------------------------------------- the labourer reads none of it
reset role;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.incident_notices) = 0, 'a labourer read an incident notice';
  assert (select count(*) from public.head_contractor_documents) = 0, 'a labourer read the plans register';
  assert (select count(*) from public.swms_reviews) = 0, 'a labourer read SWMS reviews';
  raise notice 'PASS  the labourer reads none of it';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL SUBCONTRACTOR TESTS PASSED'; end $$;
rollback;
