-- Form schedules (README R181): a schedule names a form code and what it is about; the next due counts from the
-- last COMPLETED form it produced; a form started from a schedule keeps the link; the reminder stamp is the
-- server's; a schedule is retired, never deleted. The VOC's ticket names the passed form and nothing else will do.
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
  ('00000000-0000-0000-ac71-000000000001', 'sup71@example.com'),
  ('00000000-0000-0000-ac71-000000000003', 'lab71@example.com'),
  ('00000000-0000-0000-ac71-000000000005', 'pm71@example.com'),
  ('00000000-0000-0000-ac71-000000000006', 'sup71b@example.com');
insert into public.profiles (id, email, full_name) values
  ('00000000-0000-0000-ac71-000000000001', 'sup71@example.com', 'Sue Pervisor'),
  ('00000000-0000-0000-ac71-000000000003', 'lab71@example.com', 'Sam Labourer'),
  ('00000000-0000-0000-ac71-000000000005', 'pm71@example.com', 'Pat Manager'),
  ('00000000-0000-0000-ac71-000000000006', 'sup71b@example.com', 'Other Company')
  on conflict (id) do nothing;
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-0000-0000-ac71-000000000001', 'Kingsbridge Civil', 'KB71'),
  ('aaaaaaaa-0000-0000-ac71-000000000002', 'Other Civil', 'OC71');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-ac71-000000000001', 'aaaaaaaa-0000-0000-ac71-000000000001', 'Northern', 'C071'),
  ('bbbbbbbb-0000-0000-ac71-000000000002', 'aaaaaaaa-0000-0000-ac71-000000000002', 'Elsewhere', 'X071');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-ac71-000000000001', '00000000-0000-0000-ac71-000000000001', 'supervisor'),
  ('bbbbbbbb-0000-0000-ac71-000000000001', '00000000-0000-0000-ac71-000000000003', 'labourer'),
  ('bbbbbbbb-0000-0000-ac71-000000000001', '00000000-0000-0000-ac71-000000000005', 'pm'),
  ('bbbbbbbb-0000-0000-ac71-000000000002', '00000000-0000-0000-ac71-000000000006', 'supervisor');
insert into public.plant_register (id, org_id, name, kind, plant_no) values
  ('dddddddd-0000-0000-ac71-000000000001', 'aaaaaaaa-0000-0000-ac71-000000000001', '14t Excavator', 'excavator', 'KBS-14'),
  ('dddddddd-0000-0000-ac71-000000000002', 'aaaaaaaa-0000-0000-ac71-000000000002', 'Their Roller', 'roller', 'X-1');

-- Three issued forms: a weekly crack inspection about a machine, a VOC about a person that offers the excavator
-- ticket, and a fatigue check about nothing in particular. Issued by the office.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac71-000000000005","role":"authenticated"}', true);
set local role authenticated;
insert into public.form_templates (id, org_id, title, category, subject, signature, created_by, spec) values
  ('cccccccc-0000-0000-ac71-000000000001', 'aaaaaaaa-0000-0000-ac71-000000000001', 'Weekly excavator crack inspection', 'plant', 'plant', 'required', '00000000-0000-0000-ac71-000000000005',
   '{"header": [], "sections": [{"title": "Structure", "questions": [{"key": "boom", "label": "Boom and dipper free of cracks", "type": "yes_no", "required": true, "fail": "no", "raise_action": true}]}]}'::jsonb),
  ('cccccccc-0000-0000-ac71-000000000002', 'aaaaaaaa-0000-0000-ac71-000000000001', 'VOC — excavator', 'plant', 'person', 'required', '00000000-0000-0000-ac71-000000000005',
   '{"header": [], "sections": [{"title": "Assessment", "questions": [{"key": "controls", "label": "Operates the controls competently", "type": "pass_fail", "required": true}]}]}'::jsonb),
  ('cccccccc-0000-0000-ac71-000000000003', 'aaaaaaaa-0000-0000-ac71-000000000001', 'Fatigue check', 'people', 'none', 'none', '00000000-0000-0000-ac71-000000000005',
   '{"header": [], "sections": [{"title": "Before the shift", "questions": [{"key": "slept", "label": "Slept 7 hours or more", "type": "yes_no", "required": true, "fail": "no"}]}]}'::jsonb);
update public.form_templates set competency_key = 'excavator' where id = 'cccccccc-0000-0000-ac71-000000000002';
update public.form_templates set status = 'issued' where org_id = 'aaaaaaaa-0000-0000-ac71-000000000001';
do $$ begin assert (select count(*) from public.form_templates where status = 'issued' and org_id = 'aaaaaaaa-0000-0000-ac71-000000000001') = 3, 'forms not issued'; end $$;

-- 1. Who sets a schedule, and what it must name.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac71-000000000001","role":"authenticated"}', true);
select tests.expect_error($q$ insert into public.form_schedules (id, org_id, project_id, template_code, every, unit, first_due_on)
  values ('eeeeeeee-0000-0000-ac71-000000000009', 'aaaaaaaa-0000-0000-ac71-000000000001', 'bbbbbbbb-0000-0000-ac71-000000000001', 'FRM-001', 1, 'week', '2026-01-05') $q$, 'which machine');
select tests.expect_error($q$ insert into public.form_schedules (id, org_id, project_id, template_code, subject_plant_id, every, unit, first_due_on)
  values ('eeeeeeee-0000-0000-ac71-000000000009', 'aaaaaaaa-0000-0000-ac71-000000000001', 'bbbbbbbb-0000-0000-ac71-000000000001', 'FRM-001', 'dddddddd-0000-0000-ac71-000000000002', 1, 'week', '2026-01-05') $q$, 'not on the company');
select tests.expect_error($q$ insert into public.form_schedules (id, org_id, project_id, template_code, subject_plant_id, every, unit, first_due_on)
  values ('eeeeeeee-0000-0000-ac71-000000000009', 'aaaaaaaa-0000-0000-ac71-000000000001', 'bbbbbbbb-0000-0000-ac71-000000000001', 'FRM-009', 'dddddddd-0000-0000-ac71-000000000001', 1, 'week', '2026-01-05') $q$, 'no form with that code');
-- A supervisor sets one on their job; a company-wide one is the office's.
insert into public.form_schedules (id, org_id, project_id, template_code, subject_plant_id, assigned_to, every, unit, first_due_on)
values ('eeeeeeee-0000-0000-ac71-000000000001', 'aaaaaaaa-0000-0000-ac71-000000000001', 'bbbbbbbb-0000-0000-ac71-000000000001', 'FRM-001', 'dddddddd-0000-0000-ac71-000000000001', '00000000-0000-0000-ac71-000000000003', 1, 'week', '2026-01-05');
select tests.expect_error($q$ insert into public.form_schedules (id, org_id, project_id, template_code, every, unit, first_due_on)
  values ('eeeeeeee-0000-0000-ac71-000000000009', 'aaaaaaaa-0000-0000-ac71-000000000001', null, 'FRM-003', 1, 'day', '2026-01-05') $q$, 'row-level security');
select tests.expect_error($q$ insert into public.form_schedules (id, org_id, project_id, template_code, subject_plant_id, assigned_to, every, unit, first_due_on)
  values ('eeeeeeee-0000-0000-ac71-000000000009', 'aaaaaaaa-0000-0000-ac71-000000000001', 'bbbbbbbb-0000-0000-ac71-000000000001', 'FRM-001', 'dddddddd-0000-0000-ac71-000000000001', '00000000-0000-0000-ac71-000000000006', 1, 'week', '2026-01-05') $q$, 'someone on the job');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac71-000000000005","role":"authenticated"}', true);
insert into public.form_schedules (id, org_id, project_id, template_code, every, unit, first_due_on)
values ('eeeeeeee-0000-0000-ac71-000000000002', 'aaaaaaaa-0000-0000-ac71-000000000001', null, 'FRM-003', 1, 'month', '2026-01-31');
do $$ begin
  assert app.form_next_due('eeeeeeee-0000-0000-ac71-000000000001') = '2026-01-05'::date, 'first due is not the next due';
  assert (select created_by from public.form_schedules where id = 'eeeeeeee-0000-0000-ac71-000000000002') = '00000000-0000-0000-ac71-000000000005', 'created_by not stamped';
end $$;
-- The labourer reads the schedule assigned to them and no other.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac71-000000000003","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.form_schedules) = 1, 'the labourer sees ' || (select count(*) from public.form_schedules) || ' schedules, not the one assigned to them';
  assert (select id from public.form_schedules) = 'eeeeeeee-0000-0000-ac71-000000000001', 'the labourer sees the wrong schedule';
end $$;
update public.form_schedules set every = 3 where id = 'eeeeeeee-0000-0000-ac71-000000000001';
do $$ begin assert (select every from public.form_schedules where id = 'eeeeeeee-0000-0000-ac71-000000000001') = 1, 'the labourer changed a schedule'; end $$;
do $$ begin raise notice 'PASS  1 set by the site for a job, by the office company-wide; names its machine; read by its assignee'; end $$;

-- 2. A form started from the schedule keeps the link; the next due counts from when it was DONE.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac71-000000000003","role":"authenticated"}', true);
select tests.expect_error($q$ insert into public.form_submissions (id, project_id, template_id, started_by, schedule_id)
  values ('ffffffff-0000-0000-ac71-000000000009', 'bbbbbbbb-0000-0000-ac71-000000000001', 'cccccccc-0000-0000-ac71-000000000003', '00000000-0000-0000-ac71-000000000003', 'eeeeeeee-0000-0000-ac71-000000000001') $q$, 'another form');
insert into public.form_submissions (id, project_id, template_id, started_by, schedule_id, subject_plant_id)
values ('ffffffff-0000-0000-ac71-000000000001', 'bbbbbbbb-0000-0000-ac71-000000000001', 'cccccccc-0000-0000-ac71-000000000001', '00000000-0000-0000-ac71-000000000003', 'eeeeeeee-0000-0000-ac71-000000000001', 'dddddddd-0000-0000-ac71-000000000001');
select tests.expect_error($q$ update public.form_submissions set schedule_id = null where id = 'ffffffff-0000-0000-ac71-000000000001' $q$, 'its schedule');
-- Done nine days after it fell due: the next one is a week from the DOING, not two weeks from the due.
update public.form_submissions set status = 'completed', answers = '{"boom": {"value": "yes"}}'::jsonb,
  completed_on_device_at = '2026-01-14 09:00:00+08',
  signature_path = 'bbbbbbbb-0000-0000-ac71-000000000001/form/ffffffff-0000-0000-ac71-000000000001/sig.png'
  where id = 'ffffffff-0000-0000-ac71-000000000001';
do $$ begin
  assert (select status from public.form_submissions where id = 'ffffffff-0000-0000-ac71-000000000001') = 'completed', 'not completed';
  assert app.form_next_due('eeeeeeee-0000-0000-ac71-000000000001') = '2026-01-21'::date, 'next due not a week from done: ' || app.form_next_due('eeeeeeee-0000-0000-ac71-000000000001');
end $$;
-- A completion at 01:00 Perth on the 15th is the 15th, not the UTC 14th.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac71-000000000001","role":"authenticated"}', true);
insert into public.form_submissions (id, project_id, template_id, started_by, schedule_id, subject_plant_id)
values ('ffffffff-0000-0000-ac71-000000000002', 'bbbbbbbb-0000-0000-ac71-000000000001', 'cccccccc-0000-0000-ac71-000000000001', '00000000-0000-0000-ac71-000000000001', 'eeeeeeee-0000-0000-ac71-000000000001', 'dddddddd-0000-0000-ac71-000000000001');
update public.form_submissions set status = 'completed', answers = '{"boom": {"value": "yes"}}'::jsonb,
  completed_on_device_at = '2026-01-15 01:00:00+08',
  signature_path = 'bbbbbbbb-0000-0000-ac71-000000000001/form/ffffffff-0000-0000-ac71-000000000002/sig.png'
  where id = 'ffffffff-0000-0000-ac71-000000000002';
do $$ begin
  assert app.form_next_due('eeeeeeee-0000-0000-ac71-000000000001') = '2026-01-22'::date, 'Perth day not used: ' || app.form_next_due('eeeeeeee-0000-0000-ac71-000000000001');
end $$;
-- A month from the 31st of January is the last day of February.
insert into public.form_submissions (id, project_id, template_id, started_by, schedule_id)
values ('ffffffff-0000-0000-ac71-000000000003', 'bbbbbbbb-0000-0000-ac71-000000000001', 'cccccccc-0000-0000-ac71-000000000003', '00000000-0000-0000-ac71-000000000001', 'eeeeeeee-0000-0000-ac71-000000000002');
update public.form_submissions set status = 'completed', answers = '{"slept": {"value": "yes"}}'::jsonb, completed_on_device_at = '2026-01-31 15:00:00+08'
  where id = 'ffffffff-0000-0000-ac71-000000000003';
do $$ begin
  assert app.form_next_due('eeeeeeee-0000-0000-ac71-000000000002') = '2026-02-28'::date, 'month not clamped: ' || app.form_next_due('eeeeeeee-0000-0000-ac71-000000000002');
end $$;
-- Another job's schedule is refused.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac71-000000000006","role":"authenticated"}', true);
select tests.expect_error($q$ insert into public.form_submissions (id, project_id, template_id, started_by, schedule_id)
  values ('ffffffff-0000-0000-ac71-000000000009', 'bbbbbbbb-0000-0000-ac71-000000000002', 'cccccccc-0000-0000-ac71-000000000003', '00000000-0000-0000-ac71-000000000006', 'eeeeeeee-0000-0000-ac71-000000000002') $q$, 'another company');
do $$ begin raise notice 'PASS  2 the link is kept; next due counts from the Perth day it was done; months clamp'; end $$;

-- 3. Frozen fields, the server's stamp, retirement.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac71-000000000001","role":"authenticated"}', true);
select tests.expect_error($q$ update public.form_schedules set template_code = 'FRM-003' where id = 'eeeeeeee-0000-0000-ac71-000000000001' $q$, 'keeps its company');
-- (A signed-in delete is filtered by the policies, 0 rows; the trigger's refusal is proved as the service role below.)
update public.form_schedules set last_reminded_on = '2026-01-20', every = 2 where id = 'eeeeeeee-0000-0000-ac71-000000000001';
do $$ declare r record; begin
  select * into r from public.form_schedules where id = 'eeeeeeee-0000-0000-ac71-000000000001';
  assert r.every = 2 and r.last_reminded_on is null, 'a signed-in account moved the reminder stamp';
  assert app.form_next_due('eeeeeeee-0000-0000-ac71-000000000001') = '2026-01-29'::date, 'every 2 weeks not applied';
end $$;
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.form_schedules set last_reminded_on = '2026-01-20' where id = 'eeeeeeee-0000-0000-ac71-000000000001';
do $$ begin assert (select last_reminded_on from public.form_schedules where id = 'eeeeeeee-0000-0000-ac71-000000000001') = '2026-01-20'::date, 'the sweep could not stamp'; end $$;
select tests.expect_error($q$ delete from public.form_schedules where id = 'eeeeeeee-0000-0000-ac71-000000000001' $q$, 'never deleted');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac71-000000000001","role":"authenticated"}', true);
set local role authenticated;
update public.form_schedules set active = false where id = 'eeeeeeee-0000-0000-ac71-000000000001';
do $$ begin assert app.form_next_due('eeeeeeee-0000-0000-ac71-000000000001') is null, 'a retired schedule still falls due'; end $$;
do $$ begin raise notice 'PASS  3 code and job frozen; the reminder stamp is the server''s; retired = nothing due'; end $$;

-- 4. The VOC's ticket stands on the passed form that names the person, once.
insert into public.form_submissions (id, project_id, template_id, started_by, subject_person)
values ('ffffffff-0000-0000-ac71-000000000004', 'bbbbbbbb-0000-0000-ac71-000000000001', 'cccccccc-0000-0000-ac71-000000000002', '00000000-0000-0000-ac71-000000000001', 'Sam Labourer');
select tests.expect_error($q$ insert into public.crew_tickets (org_id, person_name, ticket_type, form_submission_id)
  values ('aaaaaaaa-0000-0000-ac71-000000000001', 'Sam Labourer', 'excavator', 'ffffffff-0000-0000-ac71-000000000004') $q$, 'completed form that passed');
update public.form_submissions set status = 'completed', answers = '{"controls": {"value": "fail"}}'::jsonb, completed_on_device_at = '2026-02-02 10:00:00+08',
  signature_path = 'bbbbbbbb-0000-0000-ac71-000000000001/form/ffffffff-0000-0000-ac71-000000000004/sig.png'
  where id = 'ffffffff-0000-0000-ac71-000000000004';
select tests.expect_error($q$ insert into public.crew_tickets (org_id, person_name, ticket_type, form_submission_id)
  values ('aaaaaaaa-0000-0000-ac71-000000000001', 'Sam Labourer', 'excavator', 'ffffffff-0000-0000-ac71-000000000004') $q$, 'completed form that passed');
insert into public.form_submissions (id, project_id, template_id, started_by, subject_person)
values ('ffffffff-0000-0000-ac71-000000000005', 'bbbbbbbb-0000-0000-ac71-000000000001', 'cccccccc-0000-0000-ac71-000000000002', '00000000-0000-0000-ac71-000000000001', 'Sam Labourer');
update public.form_submissions set status = 'completed', answers = '{"controls": {"value": "pass"}}'::jsonb, completed_on_device_at = '2026-02-03 10:00:00+08',
  signature_path = 'bbbbbbbb-0000-0000-ac71-000000000001/form/ffffffff-0000-0000-ac71-000000000005/sig.png'
  where id = 'ffffffff-0000-0000-ac71-000000000005';
do $$ begin assert (select outcome from public.form_submissions where id = 'ffffffff-0000-0000-ac71-000000000005') = 'pass', 'the VOC did not pass'; end $$;
select tests.expect_error($q$ insert into public.crew_tickets (org_id, person_name, ticket_type, form_submission_id)
  values ('aaaaaaaa-0000-0000-ac71-000000000001', 'Sam Labourer', 'roller', 'ffffffff-0000-0000-ac71-000000000005') $q$, 'does not assess this ticket');
select tests.expect_error($q$ insert into public.crew_tickets (org_id, person_name, ticket_type, form_submission_id)
  values ('aaaaaaaa-0000-0000-ac71-000000000001', 'Someone Else', 'excavator', 'ffffffff-0000-0000-ac71-000000000005') $q$, 'names the person');
insert into public.crew_tickets (id, org_id, person_name, ticket_type, form_submission_id, created_by)
values ('99999999-0000-0000-ac71-000000000001', 'aaaaaaaa-0000-0000-ac71-000000000001', 'sam labourer', 'excavator', 'ffffffff-0000-0000-ac71-000000000005', '00000000-0000-0000-ac71-000000000001');
do $$ declare r record; begin
  select * into r from public.crew_tickets where id = '99999999-0000-0000-ac71-000000000001';
  assert r.issued_on = '2026-02-03'::date, 'issued_on not the day the VOC was done: ' || coalesce(r.issued_on::text, 'null');
end $$;
select tests.expect_error($q$ insert into public.crew_tickets (org_id, person_name, ticket_type, form_submission_id)
  values ('aaaaaaaa-0000-0000-ac71-000000000001', 'Sam Labourer', 'excavator', 'ffffffff-0000-0000-ac71-000000000005') $q$, 'crew_tickets_form_once');
-- The other company cannot hang a ticket on it.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac71-000000000006","role":"authenticated"}', true);
select tests.expect_error($q$ insert into public.crew_tickets (org_id, person_name, ticket_type, form_submission_id)
  values ('aaaaaaaa-0000-0000-ac71-000000000002', 'Sam Labourer', 'excavator', 'ffffffff-0000-0000-ac71-000000000005') $q$, 'another company');
do $$ begin raise notice 'PASS  4 the VOC ticket stands on the passed form, for its person, once'; end $$;

rollback;
