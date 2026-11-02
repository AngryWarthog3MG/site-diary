-- Forms engine (README R180): templates versioned and frozen on issue; a submission copies the form, saves as it
-- goes, completes only whole, then freezes; failing answers land on the non-compliance register and the raised ones
-- in the action register; the labourer fills what names them and reads their own.
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
  ('00000000-0000-0000-ac70-000000000001', 'sup70@example.com'),
  ('00000000-0000-0000-ac70-000000000002', 'lh70@example.com'),
  ('00000000-0000-0000-ac70-000000000003', 'lab70@example.com'),
  ('00000000-0000-0000-ac70-000000000004', 'lab70b@example.com'),
  ('00000000-0000-0000-ac70-000000000005', 'pm70@example.com'),
  ('00000000-0000-0000-ac70-000000000006', 'sup70b@example.com');
insert into public.profiles (id, email, full_name) values
  ('00000000-0000-0000-ac70-000000000001', 'sup70@example.com', 'Sue Pervisor'),
  ('00000000-0000-0000-ac70-000000000002', 'lh70@example.com', 'Lee Hand'),
  ('00000000-0000-0000-ac70-000000000003', 'lab70@example.com', 'Sam Labourer'),
  ('00000000-0000-0000-ac70-000000000004', 'lab70b@example.com', 'Other Labourer'),
  ('00000000-0000-0000-ac70-000000000005', 'pm70@example.com', 'Pat Manager'),
  ('00000000-0000-0000-ac70-000000000006', 'sup70b@example.com', 'Other Company')
  on conflict (id) do nothing;
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-0000-0000-ac70-000000000001', 'Kingsbridge Civil', 'KB70'),
  ('aaaaaaaa-0000-0000-ac70-000000000002', 'Other Civil', 'OC70');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-ac70-000000000001', 'aaaaaaaa-0000-0000-ac70-000000000001', 'Northern', 'C070'),
  ('bbbbbbbb-0000-0000-ac70-000000000002', 'aaaaaaaa-0000-0000-ac70-000000000002', 'Elsewhere', 'X070');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-ac70-000000000001', '00000000-0000-0000-ac70-000000000001', 'supervisor'),
  ('bbbbbbbb-0000-0000-ac70-000000000001', '00000000-0000-0000-ac70-000000000002', 'leading_hand'),
  ('bbbbbbbb-0000-0000-ac70-000000000001', '00000000-0000-0000-ac70-000000000003', 'labourer'),
  ('bbbbbbbb-0000-0000-ac70-000000000001', '00000000-0000-0000-ac70-000000000004', 'labourer'),
  ('bbbbbbbb-0000-0000-ac70-000000000001', '00000000-0000-0000-ac70-000000000005', 'pm'),
  ('bbbbbbbb-0000-0000-ac70-000000000002', '00000000-0000-0000-ac70-000000000006', 'supervisor');

-- 1. The office drafts a form; a supervisor cannot; a broken form will not issue; issued = frozen.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac70-000000000001","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$ insert into public.form_templates (id, org_id, title, created_by)
  values ('cccccccc-0000-0000-ac70-000000000009', 'aaaaaaaa-0000-0000-ac70-000000000001', 'Not mine', '00000000-0000-0000-ac70-000000000001') $q$, 'row-level security');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac70-000000000005","role":"authenticated"}', true);
insert into public.form_templates (id, org_id, title, category, audience, created_by, spec)
values ('cccccccc-0000-0000-ac70-000000000001', 'aaaaaaaa-0000-0000-ac70-000000000001', '  Fatigue checklist ', 'people',
        array['labourer', 'leading_hand'], '00000000-0000-0000-ac70-000000000005',
        '{"header": [], "sections": [{"title": "Before the shift", "questions": [
           {"key": "slept", "label": "Slept 7 hours or more", "type": "yes_no", "required": true, "fail": "no", "raise_action": true},
           {"key": "slept", "label": "Duplicate key", "type": "yes_no"}]}]}'::jsonb);
do $$ declare r record; begin
  select * into r from public.form_templates where id = 'cccccccc-0000-0000-ac70-000000000001';
  assert r.code = 'FRM-001' and r.revision = 'A' and r.status = 'draft' and r.title = 'Fatigue checklist', 'draft not born right: ' || r.code || r.revision || r.status;
end $$;
select tests.expect_error($q$ update public.form_templates set status = 'issued' where id = 'cccccccc-0000-0000-ac70-000000000001' $q$, 'used twice');
update public.form_templates set spec = '{"header": [{"key": "shift", "label": "Shift", "type": "select", "options": ["Day", "Night"]}],
  "sections": [
   {"title": "Before the shift", "questions": [
     {"key": "slept", "label": "Slept 7 hours or more", "type": "yes_no", "required": true, "fail": "no", "raise_action": true},
     {"key": "alert", "label": "How alert do you feel", "type": "score", "max": 5, "fail": 3, "required": true},
     {"key": "meds", "label": "Taking medication that affects alertness", "type": "yes_no", "fail": "yes", "photo_required": true},
     {"key": "comment", "label": "Anything else", "type": "text"}]}]}'::jsonb, status = 'issued'
 where id = 'cccccccc-0000-0000-ac70-000000000001';
do $$ declare r record; begin
  select * into r from public.form_templates where id = 'cccccccc-0000-0000-ac70-000000000001';
  assert r.status = 'issued' and r.issued_at is not null and r.issued_by = '00000000-0000-0000-ac70-000000000005', 'not issued';
end $$;
select tests.expect_error($q$ update public.form_templates set title = 'Renamed' where id = 'cccccccc-0000-0000-ac70-000000000001' $q$, 'new revision');
select tests.expect_error($q$ delete from public.form_templates where id = 'cccccccc-0000-0000-ac70-000000000001' $q$, 'never removed');
do $$ begin raise notice 'PASS  1 drafted by the office, refused broken, issued and frozen'; end $$;

-- 2. A revision is a new row with the same code; issuing it supersedes the last.
insert into public.form_templates (id, org_id, title, category, audience, supersedes_id, created_by, spec, pass_mark)
select 'cccccccc-0000-0000-ac70-000000000002', org_id, title, category, audience, id, '00000000-0000-0000-ac70-000000000005', spec, 60
  from public.form_templates where id = 'cccccccc-0000-0000-ac70-000000000001';
do $$ declare r record; begin
  select * into r from public.form_templates where id = 'cccccccc-0000-0000-ac70-000000000002';
  assert r.code = 'FRM-001' and r.revision = 'B' and r.status = 'draft', 'revision not B: ' || r.code || r.revision;
end $$;
update public.form_templates set status = 'issued' where id = 'cccccccc-0000-0000-ac70-000000000002';
do $$ begin
  assert (select status from public.form_templates where id = 'cccccccc-0000-0000-ac70-000000000001') = 'superseded', 'A not superseded';
  assert (select status from public.form_templates where id = 'cccccccc-0000-0000-ac70-000000000002') = 'issued', 'B not issued';
end $$;
-- A form for supervisors only, which the labourer must not even see.
insert into public.form_templates (id, org_id, title, audience, created_by, spec)
values ('cccccccc-0000-0000-ac70-000000000003', 'aaaaaaaa-0000-0000-ac70-000000000001', 'Field leadership observation', array['supervisor'],
        '00000000-0000-0000-ac70-000000000005', '{"header": [], "sections": [{"title": "Observed", "questions": [{"key": "ppe", "label": "PPE worn", "type": "ok_issue_na"}]}]}'::jsonb);
update public.form_templates set status = 'issued' where id = 'cccccccc-0000-0000-ac70-000000000003';
do $$ begin raise notice 'PASS  2 revision B supersedes A on issue'; end $$;

-- 3. The labourer starts the form that names them, on the issued revision only; sees only it; the other labourer sees none of theirs.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac70-000000000003","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.form_templates) = 1, 'the labourer sees ' || (select count(*) from public.form_templates) || ' templates, not the one that names them';
end $$;
select tests.expect_error($q$ insert into public.form_submissions (id, project_id, template_id, started_by)
  values ('dddddddd-0000-0000-ac70-000000000009', 'bbbbbbbb-0000-0000-ac70-000000000001', 'cccccccc-0000-0000-ac70-000000000001', '00000000-0000-0000-ac70-000000000003') $q$, 'not issued');
insert into public.form_submissions (id, project_id, template_id, started_by)
values ('dddddddd-0000-0000-ac70-000000000001', 'bbbbbbbb-0000-0000-ac70-000000000001', 'cccccccc-0000-0000-ac70-000000000002', '00000000-0000-0000-ac70-000000000003');
do $$ declare r record; begin
  select * into r from public.form_submissions where id = 'dddddddd-0000-0000-ac70-000000000001';
  assert r.status = 'open' and r.template_code = 'FRM-001' and r.revision = 'B' and r.pass_mark = 60 and r.spec -> 'sections' is not null, 'submission not born from the template';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac70-000000000004","role":"authenticated"}', true);
do $$ begin assert (select count(*) from public.form_submissions) = 0, 'another labourer reads it'; end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac70-000000000001","role":"authenticated"}', true);
do $$ begin assert (select count(*) from public.form_submissions) = 1, 'the supervisor does not read it'; end $$;
do $$ begin raise notice 'PASS  3 the labourer starts the form that names them; reads only their own'; end $$;

-- 4. Completion is whole or not at all: required, photo on a fail, the signature in its own folder; then scored and frozen.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac70-000000000003","role":"authenticated"}', true);
update public.form_submissions set answers = '{"slept": {"value": "no"}}'::jsonb where id = 'dddddddd-0000-0000-ac70-000000000001';
select tests.expect_error($q$ update public.form_submissions set status = 'completed', signature_path = 'bbbbbbbb-0000-0000-ac70-000000000001/form/dddddddd-0000-0000-ac70-000000000001/sig.png'
  where id = 'dddddddd-0000-0000-ac70-000000000001' $q$, 'not answered');
select tests.expect_error($q$ update public.form_submissions set status = 'completed',
  answers = '{"slept": {"value": "no"}, "alert": {"value": 2}, "meds": {"value": "yes"}}'::jsonb,
  signature_path = 'bbbbbbbb-0000-0000-ac70-000000000001/form/dddddddd-0000-0000-ac70-000000000001/sig.png'
  where id = 'dddddddd-0000-0000-ac70-000000000001' $q$, 'needs a photograph');
select tests.expect_error($q$ update public.form_submissions set status = 'completed',
  answers = '{"slept": {"value": "no"}, "alert": {"value": 2}, "meds": {"value": "yes", "photo_paths": ["bbbbbbbb-0000-0000-ac70-000000000001/form/dddddddd-0000-0000-ac70-000000000001/meds.jpg"]}}'::jsonb,
  signature_path = 'bbbbbbbb-0000-0000-ac70-000000000001/form/dddddddd-0000-0000-ac70-000000000009/sig.png'
  where id = 'dddddddd-0000-0000-ac70-000000000001' $q$, 'own folder');
select tests.expect_error($q$ update public.form_submissions set status = 'completed',
  answers = '{"slept": {"value": "no"}, "alert": {"value": 2}, "meds": {"value": "yes", "photo_paths": ["bbbbbbbb-0000-0000-ac70-000000000001/form/dddddddd-0000-0000-ac70-000000000001/meds.jpg"]}}'::jsonb
  where id = 'dddddddd-0000-0000-ac70-000000000001' $q$, 'the signature');
update public.form_submissions set status = 'completed', completed_on_device_at = now() - interval '5 minutes',
  answers = '{"slept": {"value": "no", "note": "Baby up all night"}, "alert": {"value": 2}, "meds": {"value": "yes", "photo_paths": ["bbbbbbbb-0000-0000-ac70-000000000001/form/dddddddd-0000-0000-ac70-000000000001/meds.jpg"]}, "comment": {"value": "ok"}}'::jsonb,
  signature_path = 'bbbbbbbb-0000-0000-ac70-000000000001/form/dddddddd-0000-0000-ac70-000000000001/sig.png'
  where id = 'dddddddd-0000-0000-ac70-000000000001';
do $$ declare r record; begin
  select * into r from public.form_submissions where id = 'dddddddd-0000-0000-ac70-000000000001';
  assert r.status = 'completed' and r.completed_at is not null and r.completed_by = '00000000-0000-0000-ac70-000000000003', 'not completed';
  assert r.score = 40.0, 'score ' || coalesce(r.score::text, 'null') || ' not 40.0';
  assert r.outcome = 'fail', 'outcome ' || coalesce(r.outcome, 'null');
  assert (select count(*) from public.form_non_compliances where submission_id = r.id) = 3, 'three failing answers expected';
  assert (select raised_as_action from public.form_non_compliances where submission_id = r.id and question_key = 'slept'), 'slept not raised';
  assert (select action from public.form_non_compliances where submission_id = r.id and question_key = 'slept') = 'Fatigue checklist: Slept 7 hours or more', 'action wording';
  assert not (select raised_as_action from public.form_non_compliances where submission_id = r.id and question_key = 'alert'), 'alert raised';
  assert (select photo_paths[1] from public.form_non_compliances where submission_id = r.id and question_key = 'meds') like '%meds.jpg', 'photo not carried';
end $$;
select tests.expect_error($q$ update public.form_submissions set answers = '{}'::jsonb where id = 'dddddddd-0000-0000-ac70-000000000001' $q$, 'frozen');
select tests.expect_error($q$ update public.form_submissions set status = 'voided', void_reason = 'oops' where id = 'dddddddd-0000-0000-ac70-000000000001' $q$, 'only the office');
-- Under RLS the delete policy filters the row out silently (0 rows); the trigger's refusal is proven as the service role.
reset role;
select tests.expect_error($q$ delete from public.form_submissions where id = 'dddddddd-0000-0000-ac70-000000000001' $q$, 'part of the record');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac70-000000000003","role":"authenticated"}', true);
set local role authenticated;
do $$ begin assert (select count(*) from public.form_non_compliances) = 3, 'the labourer does not read their own non-compliances'; end $$;
do $$ begin raise notice 'PASS  4 completion whole or not at all; scored, failed, non-compliances born, frozen'; end $$;

-- 5. The raised one is in the action register as origin form; completing it resolves the non-compliance, and the other way round.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac70-000000000001","role":"authenticated"}', true);
do $$ declare r record; begin
  select * into r from public.action_register where origin = 'form';
  assert r.id is not null and r.record_ref like 'FRM-001 %' and r.action like 'Fatigue checklist:%' and r.done_at is null and r.project_id = 'bbbbbbbb-0000-0000-ac70-000000000001', 'form action not in the register';
  assert (select count(*) from public.action_register where origin = 'form') = 1, 'only the raised one is an action';
end $$;
select public.update_action('form', (select id from public.form_non_compliances where question_key = 'slept'), '00000000-0000-0000-ac70-000000000002', 'high', current_date + 2, null);
select tests.expect_error($q$ select public.update_action('form', (select id from public.form_non_compliances where question_key = 'slept'), '00000000-0000-0000-ac70-000000000006', 'high', null, null) $q$, 'someone on the job');
select public.complete_action('form', (select id from public.form_non_compliances where question_key = 'slept'), 'Sent home to rest');
do $$ declare r record; begin
  select * into r from public.form_non_compliances where question_key = 'slept';
  assert r.status = 'resolved' and r.resolution = 'Sent home to rest' and r.resolved_by = '00000000-0000-0000-ac70-000000000001' and r.done_at is not null and r.assigned_to = '00000000-0000-0000-ac70-000000000002' and r.priority = 'high', 'complete_action did not resolve';
end $$;
select tests.expect_error($q$ update public.form_non_compliances set resolution = 'changed' where question_key = 'slept' $q$, 'frozen');
-- The leading hand resolves a plain non-compliance from its own register; without a resolution it is refused.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac70-000000000002","role":"authenticated"}', true);
select tests.expect_error($q$ update public.form_non_compliances set status = 'resolved' where question_key = 'alert' $q$, 'how it was resolved');
update public.form_non_compliances set status = 'resolved', resolution = 'Talked it through; on light duties' where question_key = 'alert';
do $$ begin assert (select status from public.form_non_compliances where question_key = 'alert') = 'resolved', 'not resolved'; end $$;
-- Raising a plain one as an action by hand, then it shows in the register.
update public.form_non_compliances set raised_as_action = true, action = 'Check the medication with the doctor' where question_key = 'meds';
do $$ begin assert (select count(*) from public.action_register where origin = 'form') = 2, 'raised by hand not in the register'; end $$;
select tests.expect_error($q$ update public.form_non_compliances set raised_as_action = false where question_key = 'meds' $q$, 'stays raised');
select tests.expect_error($q$ update public.form_non_compliances set status = 'removed', removed_reason = 'not real' where question_key = 'meds' $q$, 'only the office');
reset role;
select tests.expect_error($q$ delete from public.form_non_compliances where question_key = 'meds' $q$, 'never deleted');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac70-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$ begin raise notice 'PASS  5 one row, two registers: done is resolved; raised by hand; crew cannot remove'; end $$;

-- 6. The office removes with a reason; removed = frozen and out of the action register.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac70-000000000005","role":"authenticated"}', true);
select tests.expect_error($q$ update public.form_non_compliances set status = 'removed' where question_key = 'meds' $q$, 'say why');
update public.form_non_compliances set status = 'removed', removed_reason = 'Prescribed and cleared by the doctor' where question_key = 'meds';
do $$ declare r record; begin
  select * into r from public.form_non_compliances where question_key = 'meds';
  assert r.status = 'removed' and r.removed_at is not null and r.removed_by = '00000000-0000-0000-ac70-000000000005', 'not removed';
  assert (select count(*) from public.action_register where origin = 'form') = 1, 'a removed one is still an action';
end $$;
select tests.expect_error($q$ update public.form_non_compliances set status = 'open' where question_key = 'meds' $q$, 'frozen');
do $$ begin raise notice 'PASS  6 removed with a reason by the office, then frozen'; end $$;

-- 7. Another company's supervisor cannot fill this company's form; the office voids a completed form with a reason, then it is frozen.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac70-000000000006","role":"authenticated"}', true);
select tests.expect_error($q$ insert into public.form_submissions (id, project_id, template_id, started_by)
  values ('dddddddd-0000-0000-ac70-000000000002', 'bbbbbbbb-0000-0000-ac70-000000000002', 'cccccccc-0000-0000-ac70-000000000002', '00000000-0000-0000-ac70-000000000006') $q$, 'another company');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac70-000000000005","role":"authenticated"}', true);
select tests.expect_error($q$ update public.form_submissions set status = 'voided' where id = 'dddddddd-0000-0000-ac70-000000000001' $q$, 'say why');
update public.form_submissions set status = 'voided', void_reason = 'Filled on the wrong job' where id = 'dddddddd-0000-0000-ac70-000000000001';
do $$ declare r record; begin
  select * into r from public.form_submissions where id = 'dddddddd-0000-0000-ac70-000000000001';
  assert r.status = 'voided' and r.voided_at is not null and r.completed_at is not null and r.score = 40.0, 'void lost the record';
  assert (select count(*) from public.action_register where origin = 'form') = 0, 'a voided form still raises actions';
end $$;
select tests.expect_error($q$ update public.form_submissions set void_reason = 'changed' where id = 'dddddddd-0000-0000-ac70-000000000001' $q$, 'frozen');
do $$ begin raise notice 'PASS  7 another company refused; voided with a reason by the office, then frozen'; end $$;

-- 8. A form with no failing answers passes with no non-compliance; a supervisor fills the observation form about a person.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac70-000000000001","role":"authenticated"}', true);
insert into public.form_submissions (id, project_id, template_id, started_by)
values ('dddddddd-0000-0000-ac70-000000000003', 'bbbbbbbb-0000-0000-ac70-000000000001', 'cccccccc-0000-0000-ac70-000000000003', '00000000-0000-0000-ac70-000000000001');
update public.form_submissions set status = 'completed', answers = '{"ppe": {"value": "ok"}}'::jsonb,
  signature_path = 'bbbbbbbb-0000-0000-ac70-000000000001/form/dddddddd-0000-0000-ac70-000000000003/sig.png'
  where id = 'dddddddd-0000-0000-ac70-000000000003';
do $$ declare r record; begin
  select * into r from public.form_submissions where id = 'dddddddd-0000-0000-ac70-000000000003';
  assert r.status = 'completed' and r.outcome = 'pass' and r.score is null, 'a clean form did not pass';
  assert (select count(*) from public.form_non_compliances where submission_id = r.id) = 0, 'a clean form raised a non-compliance';
end $$;
do $$ begin raise notice 'PASS  8 a clean form passes with nothing raised'; end $$;

rollback;
