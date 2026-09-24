-- The QA engine: a template is checked and, once issued, frozen; an ITP is instanced forward-only and frozen when signed;
-- a record is upserted by client id, never blocked (a gap is an answer), frozen once every required party has signed,
-- released only when every release party has, voided never deleted; the crew writes its own job's records, the office
-- everything, the labourer and outsiders nothing.
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
create function tests.n(p_sql text) returns integer language plpgsql as $$
declare r integer; begin execute p_sql into r; return r; end; $$;

insert into auth.users (id, email) values
  ('11111111-aaaa-0000-0000-000000000001', 'pm.qa@example.com'),
  ('11111111-aaaa-0000-0000-000000000002', 'sup.qa@example.com'),
  ('11111111-aaaa-0000-0000-000000000003', 'lh.qa@example.com'),
  ('11111111-aaaa-0000-0000-000000000004', 'lab.qa@example.com'),
  ('11111111-aaaa-0000-0000-000000000005', 'sup2.qa@example.com'),
  ('11111111-aaaa-0000-0000-000000000006', 'outsider.qa@example.com');
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-aaaa-0000-0000-000000000001', 'QA Civil', 'QAC'),
  ('aaaaaaaa-aaaa-0000-0000-000000000002', 'Other QA', 'OQA');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-aaaa-0000-0000-000000000001', 'aaaaaaaa-aaaa-0000-0000-000000000001', 'QA Job One', 'Q101'),
  ('bbbbbbbb-aaaa-0000-0000-000000000002', 'aaaaaaaa-aaaa-0000-0000-000000000001', 'QA Job Two', 'Q102'),
  ('bbbbbbbb-aaaa-0000-0000-000000000003', 'aaaaaaaa-aaaa-0000-0000-000000000002', 'Other Job', 'O401');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-aaaa-0000-0000-000000000001', '11111111-aaaa-0000-0000-000000000001', 'pm'),
  ('bbbbbbbb-aaaa-0000-0000-000000000002', '11111111-aaaa-0000-0000-000000000001', 'pm'),
  ('bbbbbbbb-aaaa-0000-0000-000000000001', '11111111-aaaa-0000-0000-000000000002', 'supervisor'),
  ('bbbbbbbb-aaaa-0000-0000-000000000001', '11111111-aaaa-0000-0000-000000000003', 'leading_hand'),
  ('bbbbbbbb-aaaa-0000-0000-000000000001', '11111111-aaaa-0000-0000-000000000004', 'labourer'),
  ('bbbbbbbb-aaaa-0000-0000-000000000002', '11111111-aaaa-0000-0000-000000000005', 'supervisor'),
  ('bbbbbbbb-aaaa-0000-0000-000000000003', '11111111-aaaa-0000-0000-000000000006', 'admin');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-aaaa-0000-0000-000000000001","role":"authenticated"}';

-- 1. Templates: checked on the way in; issued = frozen; the next wording is the next revision.
select tests.expect_error($$
  insert into public.qa_templates (org_id, spec) values ('aaaaaaaa-aaaa-0000-0000-000000000001',
    '{"code":"KBS-QA-T","kind":"itr_checklist","title":"Twice","revision":"A","sections":[{"title":"A","items":[{"id":"1","text":"x"},{"id":"1","text":"y"}]}]}')
$$, 'item 1 twice');
select tests.expect_error($$
  insert into public.qa_templates (org_id, spec) values ('aaaaaaaa-aaaa-0000-0000-000000000001',
    '{"code":"KBS-QA-T","kind":"itr_checklist","title":"Release without hold","revision":"A","hold_point":false,"sections":[{"title":"A","items":[{"id":"1","text":"x"}]}],"signoffs":[{"party":"P","required":true,"kind":"external","is_release":true}]}')
$$, 'release sign-off only on a hold point form');
insert into public.qa_templates (id, org_id, spec) values ('cccccccc-aaaa-0000-0000-000000000001', 'aaaaaaaa-aaaa-0000-0000-000000000001',
  '{"code":"KBS-QA-CG-001","kind":"itr_checklist","title":"Concrete on Ground - Pre-Pour Inspection","revision":"A","hold_point":true,
    "header_fields":[{"key":"pour_id","label":"Pour ID","type":"text"},{"key":"planned_at","label":"Planned pour date / time","type":"datetime"}],
    "sections":[{"title":"Set-out and formwork","items":[{"id":"1","text":"Set-out checked against current IFC revision and CDI survey marks","value_type":"text","value_label":"Comment / reference / measured value"},{"id":"2","text":"Formwork inspected and signed off","hold_point":true}]},
                {"title":"Reinforcement","items":[{"id":"3","text":"Cover and laps checked","value_type":"number"}]}],
    "signoffs":[{"party":"Kooboolong Supervisor","required":true,"kind":"internal"},{"party":"Structural Engineer","required":true,"kind":"external"},{"party":"CDI Site Manager - release to pour","required":true,"kind":"external","is_release":true}]}');
insert into public.qa_templates (id, org_id, spec) values ('cccccccc-aaaa-0000-0000-000000000002', 'aaaaaaaa-aaaa-0000-0000-000000000001',
  '{"code":"6425-KBS-ITP-002","kind":"itp","title":"Concrete on Ground","revision":"B","hold_point":true,"parties":["Kooboolong","CDI","Engineer"],
    "activities":[{"no":"1","activity":"Review IFC","governing":["Spec"],"criteria":["Current IFC"],"record":["Register"],"inspection":{"Kooboolong":"H, R","CDI":"R","Engineer":""}}],
    "signoffs":[{"party":"Kooboolong","required":true,"kind":"internal"},{"party":"CDI","required":true,"kind":"external","is_release":true}]}');
insert into public.qa_templates (id, org_id, spec) values ('cccccccc-aaaa-0000-0000-000000000003', 'aaaaaaaa-aaaa-0000-0000-000000000001',
  '{"code":"KBS-QA-REG-001","kind":"itr_register","title":"Pour register","revision":"A","columns":[{"key":"docket","label":"Docket no.","type":"text"},{"key":"m3","label":"Volume","type":"number","unit":"m3"}],"signoffs":[{"party":"Kooboolong Supervisor","required":true,"kind":"internal"}]}');
do $$
declare r record;
begin
  select * into r from public.qa_templates where id = 'cccccccc-aaaa-0000-0000-000000000001';
  if r.code <> 'KBS-QA-CG-001' or r.kind <> 'itr_checklist' or r.revision <> 'A' or r.title <> 'Concrete on Ground - Pre-Pour Inspection' or r.created_by <> '11111111-aaaa-0000-0000-000000000001' then
    raise exception 'TESTFAIL: columns should be read off the spec: % % %', r.code, r.kind, r.revision; end if;
end; $$;
-- A record against an unissued template is refused; issue them.
select tests.expect_error($$
  insert into public.qa_records (id, project_id, template_id) values ('dddddddd-aaaa-0000-0000-000000000009', 'bbbbbbbb-aaaa-0000-0000-000000000001', 'cccccccc-aaaa-0000-0000-000000000001')
$$, 'not issued yet');
update public.qa_templates set issued_at = now() where org_id = 'aaaaaaaa-aaaa-0000-0000-000000000001';
do $$
begin
  if (select issued_by from public.qa_templates where id = 'cccccccc-aaaa-0000-0000-000000000001') <> '11111111-aaaa-0000-0000-000000000001' then raise exception 'TESTFAIL: issued_by stamped'; end if;
end; $$;
select tests.expect_error($$
  update public.qa_templates set spec = jsonb_set(spec, '{title}', '"Reworded"') where id = 'cccccccc-aaaa-0000-0000-000000000001'
$$, 'issued and frozen');
insert into public.qa_templates (org_id, spec) values ('aaaaaaaa-aaaa-0000-0000-000000000001',
  '{"code":"KBS-QA-CG-001","kind":"itr_checklist","title":"Concrete on Ground - Pre-Pour Inspection","revision":"B","hold_point":true,"sections":[{"title":"A","items":[{"id":"1","text":"Reworded item"}]}],"signoffs":[{"party":"Kooboolong Supervisor","required":true,"kind":"internal"}]}');
update public.qa_templates set retired_at = now() where code = 'KBS-QA-REG-001';
reset role;
select tests.expect_error($$ delete from public.qa_templates where id = 'cccccccc-aaaa-0000-0000-000000000001' $$, 'never changed or removed');
set local role authenticated;

-- 2. An ITP on the job: office only, forward only, approval names its approver, signed = frozen.
set local request.jwt.claims = '{"sub":"11111111-aaaa-0000-0000-000000000002","role":"authenticated"}';
select tests.expect_error($$
  insert into public.qa_itp_instances (project_id, template_id) values ('bbbbbbbb-aaaa-0000-0000-000000000001', 'cccccccc-aaaa-0000-0000-000000000002')
$$, 'row-level security');
set local request.jwt.claims = '{"sub":"11111111-aaaa-0000-0000-000000000001","role":"authenticated"}';
select tests.expect_error($$
  insert into public.qa_itp_instances (project_id, template_id) values ('bbbbbbbb-aaaa-0000-0000-000000000001', 'cccccccc-aaaa-0000-0000-000000000001')
$$, 'only an itp is instanced');
insert into public.qa_itp_instances (id, project_id, template_id) values ('eeeeeeee-aaaa-0000-0000-000000000001', 'bbbbbbbb-aaaa-0000-0000-000000000001', 'cccccccc-aaaa-0000-0000-000000000002');
select tests.expect_error($$
  update public.qa_itp_instances set status = 'approved' where id = 'eeeeeeee-aaaa-0000-0000-000000000001'
$$, 'names who approved');
update public.qa_itp_instances set status = 'issued', issued_to = 'CDI Group' where id = 'eeeeeeee-aaaa-0000-0000-000000000001';
update public.qa_itp_instances set status = 'approved', approved_by_name = 'A. Dehdashti', approved_at = now(), approval_file_path = 'bbbbbbbb-aaaa-0000-0000-000000000001/qa/itp/eeeeeeee-aaaa-0000-0000-000000000001.pdf' where id = 'eeeeeeee-aaaa-0000-0000-000000000001';
select tests.expect_error($$
  update public.qa_itp_instances set status = 'draft' where id = 'eeeeeeee-aaaa-0000-0000-000000000001'
$$, 'moves forward');
update public.qa_itp_instances set status = 'signed' where id = 'eeeeeeee-aaaa-0000-0000-000000000001';
do $$
begin
  if (select signed_at from public.qa_itp_instances where id = 'eeeeeeee-aaaa-0000-0000-000000000001') is null then raise exception 'TESTFAIL: signed_at stamped'; end if;
end; $$;
select tests.expect_error($$
  update public.qa_itp_instances set issued_to = 'Someone else' where id = 'eeeeeeee-aaaa-0000-0000-000000000001'
$$, 'signed itp is frozen');

-- 3. A record: the supervisor writes it by its own id, a gap is an answer, the form's items and parties are the only ones.
set local request.jwt.claims = '{"sub":"11111111-aaaa-0000-0000-000000000002","role":"authenticated"}';
select tests.expect_error($$
  insert into public.qa_records (id, project_id, template_id, items) values ('dddddddd-aaaa-0000-0000-000000000001', 'bbbbbbbb-aaaa-0000-0000-000000000001', 'cccccccc-aaaa-0000-0000-000000000001', '[{"item_id":"9","state":"ok"}]')
$$, 'item 9 is not on this form');
select tests.expect_error($$
  insert into public.qa_records (id, project_id, template_id, header) values ('dddddddd-aaaa-0000-0000-000000000001', 'bbbbbbbb-aaaa-0000-0000-000000000001', 'cccccccc-aaaa-0000-0000-000000000001', '{"lot":"x"}')
$$, 'header field lot is not on this form');
select tests.expect_error($$
  insert into public.qa_records (id, project_id, template_id, items) values ('dddddddd-aaaa-0000-0000-000000000001', 'bbbbbbbb-aaaa-0000-0000-000000000001', 'cccccccc-aaaa-0000-0000-000000000001',
    '[{"item_id":"1","state":"ok","photo_paths":["bbbbbbbb-aaaa-0000-0000-000000000002/qa/dddddddd-aaaa-0000-0000-000000000001/p.jpg"]}]')
$$, 'record''s own folder');
insert into public.qa_records (id, project_id, template_id, itp_instance_id, activity_no, lot_or_element, header, items, submitted_at, client_created_at)
values ('dddddddd-aaaa-0000-0000-000000000001', 'bbbbbbbb-aaaa-0000-0000-000000000001', 'cccccccc-aaaa-0000-0000-000000000001', 'eeeeeeee-aaaa-0000-0000-000000000001', '1', '  Footing  SF1 ch 0-20 ',
  '{"pour_id":"P-01","planned_at":"2026-09-25T06:00:00+08:00"}',
  '[{"item_id":"1","state":"ok","value":"IFC rev D","photo_paths":["bbbbbbbb-aaaa-0000-0000-000000000001/qa/dddddddd-aaaa-0000-0000-000000000001/setout.jpg"]},{"item_id":"2","state":"gap"},{"item_id":"3","state":"gap"}]',
  now(), '2026-09-24T02:00:00Z');
do $$
declare r record;
begin
  select * into r from public.qa_records where id = 'dddddddd-aaaa-0000-0000-000000000001';
  if r.gap_count <> 2 then raise exception 'TESTFAIL: two gaps, counted %', r.gap_count; end if;
  if r.completed_at is not null or r.released_at is not null then raise exception 'TESTFAIL: unsigned, not complete'; end if;
  if r.created_by <> '11111111-aaaa-0000-0000-000000000002' then raise exception 'TESTFAIL: created_by stamped'; end if;
  if r.lot_or_element <> 'Footing SF1 ch 0-20' then raise exception 'TESTFAIL: lot tidied, got "%"', r.lot_or_element; end if;
end; $$;
-- The same id again (the phone syncing): an update, with the gap fixed and the internal sign-off.
update public.qa_records set items = '[{"item_id":"1","state":"ok","value":"IFC rev D"},{"item_id":"2","state":"ok"},{"item_id":"3","state":"gap"}]',
  signoffs = '[{"party":"Kooboolong Supervisor","signer_name":"S. Upervisor","signature_path":"bbbbbbbb-aaaa-0000-0000-000000000001/qa/dddddddd-aaaa-0000-0000-000000000001/sig-kbs.png","signed_at":"2026-09-24T03:00:00Z","signed_by_user_id":"11111111-aaaa-0000-0000-000000000002"}]'
  where id = 'dddddddd-aaaa-0000-0000-000000000001';
do $$
declare r record;
begin
  select * into r from public.qa_records where id = 'dddddddd-aaaa-0000-0000-000000000001';
  if r.gap_count <> 1 or r.completed_at is not null or r.released_at is not null then raise exception 'TESTFAIL: one party signed is not complete: gaps % complete % released %', r.gap_count, r.completed_at, r.released_at; end if;
end; $$;
select tests.expect_error($$
  update public.qa_records set signoffs = '[{"party":"Nobody","signer_name":"X","signature_path":"bbbbbbbb-aaaa-0000-0000-000000000001/qa/dddddddd-aaaa-0000-0000-000000000001/s.png","signed_at":"2026-09-24T03:00:00Z"}]' where id = 'dddddddd-aaaa-0000-0000-000000000001'
$$, 'party nobody is not on this form');
select tests.expect_error($$
  update public.qa_records set signoffs = '[]' where id = 'dddddddd-aaaa-0000-0000-000000000001'
$$, 'never changed or removed');
-- The engineer and CDI sign on the supervisor's phone: every required party signed → complete and frozen; the release party signed → released.
update public.qa_records set signoffs = signoffs || '[{"party":"Structural Engineer","signer_name":"E. Ngineer","signature_path":"bbbbbbbb-aaaa-0000-0000-000000000001/qa/dddddddd-aaaa-0000-0000-000000000001/sig-eng.png","signed_at":"2026-09-24T04:00:00Z"}]'::jsonb
  where id = 'dddddddd-aaaa-0000-0000-000000000001';
do $$
begin
  if (select completed_at from public.qa_records where id = 'dddddddd-aaaa-0000-0000-000000000001') is not null then raise exception 'TESTFAIL: CDI has not signed; not complete'; end if;
end; $$;
update public.qa_records set signoffs = signoffs || '[{"party":"CDI Site Manager - release to pour","signer_name":"R. Sambeeck","signature_path":"bbbbbbbb-aaaa-0000-0000-000000000001/qa/dddddddd-aaaa-0000-0000-000000000001/sig-cdi.png","signed_at":"2026-09-24T05:00:00Z"}]'::jsonb
  where id = 'dddddddd-aaaa-0000-0000-000000000001';
do $$
declare r record;
begin
  select * into r from public.qa_records where id = 'dddddddd-aaaa-0000-0000-000000000001';
  if r.completed_at is null or r.released_at is null then raise exception 'TESTFAIL: all three signed → complete and released'; end if;
  if r.gap_count <> 1 then raise exception 'TESTFAIL: the gap stays on the record'; end if;
end; $$;
-- Frozen: any content change is refused; void works; the original is still readable; void twice is refused.
select tests.expect_error($$
  update public.qa_records set comments = 'late note' where id = 'dddddddd-aaaa-0000-0000-000000000001'
$$, 'signed record is frozen');
select tests.expect_error($$
  update public.qa_records set voided_at = now(), void_reason = 'wrong lot', comments = 'and a note' where id = 'dddddddd-aaaa-0000-0000-000000000001'
$$, 'nothing else changes with a void');
update public.qa_records set voided_at = now(), void_reason = 'Wrong lot — SF1 ch 20-40 was poured' where id = 'dddddddd-aaaa-0000-0000-000000000001';
do $$
declare r record;
begin
  select * into r from public.qa_records where id = 'dddddddd-aaaa-0000-0000-000000000001';
  if r.voided_at is null or r.void_reason <> 'Wrong lot — SF1 ch 20-40 was poured' then raise exception 'TESTFAIL: void not recorded'; end if;
  if jsonb_array_length(r.signoffs) <> 3 or r.gap_count <> 1 or r.completed_at is null then raise exception 'TESTFAIL: the voided original must still read as it was'; end if;
end; $$;
select tests.expect_error($$
  update public.qa_records set voided_at = now(), void_reason = 'again' where id = 'dddddddd-aaaa-0000-0000-000000000001'
$$, 'is voided');
reset role;
select tests.expect_error($$ delete from public.qa_records where id = 'dddddddd-aaaa-0000-0000-000000000001' $$, 'never changed or removed');
set local role authenticated;

-- A register record: rows only carry the register's columns; a retired template still records? No — retired is read-only history: it is still issued, so it records (retiring hides it from new work in the app).
set local request.jwt.claims = '{"sub":"11111111-aaaa-0000-0000-000000000003","role":"authenticated"}';
select tests.expect_error($$
  insert into public.qa_records (id, project_id, template_id, rows) values ('dddddddd-aaaa-0000-0000-000000000002', 'bbbbbbbb-aaaa-0000-0000-000000000001', 'cccccccc-aaaa-0000-0000-000000000003', '[{"docket":"123","truck":"T1"}]')
$$, 'column truck is not on this register');
insert into public.qa_records (id, project_id, template_id, rows) values ('dddddddd-aaaa-0000-0000-000000000002', 'bbbbbbbb-aaaa-0000-0000-000000000001', 'cccccccc-aaaa-0000-0000-000000000003', '[{"docket":"123","m3":6.5},{"docket":"124","m3":6.5}]');
select tests.expect_error($$
  insert into public.qa_records (id, project_id, template_id) values ('dddddddd-aaaa-0000-0000-000000000003', 'bbbbbbbb-aaaa-0000-0000-000000000001', 'cccccccc-aaaa-0000-0000-000000000002')
$$, 'itp is instanced');

-- 4. Who sees what. The labourer: nothing. A supervisor on the other job: nothing of this one. Another company: nothing. The office: all.
set local request.jwt.claims = '{"sub":"11111111-aaaa-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  if tests.n('select count(*) from public.qa_records') <> 0 then raise exception 'TESTFAIL: the labourer read records'; end if;
  if tests.n('select count(*) from public.qa_itp_instances') <> 0 then raise exception 'TESTFAIL: the labourer read ITP instances'; end if;
end; $$;
select tests.expect_error($$
  insert into public.qa_records (id, project_id, template_id) values ('dddddddd-aaaa-0000-0000-000000000004', 'bbbbbbbb-aaaa-0000-0000-000000000001', 'cccccccc-aaaa-0000-0000-000000000001')
$$, 'row-level security');
set local request.jwt.claims = '{"sub":"11111111-aaaa-0000-0000-000000000005","role":"authenticated"}';
do $$
begin
  if tests.n('select count(*) from public.qa_records where project_id = ''bbbbbbbb-aaaa-0000-0000-000000000001''') <> 0 then raise exception 'TESTFAIL: another job''s supervisor read this job''s records'; end if;
  if tests.n('select count(*) from public.qa_templates') <> 4 then raise exception 'TESTFAIL: a supervisor of the company reads its templates'; end if;
end; $$;
select tests.expect_error($$
  insert into public.qa_templates (org_id, spec) values ('aaaaaaaa-aaaa-0000-0000-000000000001', '{"code":"X","kind":"site_form","title":"t","revision":"A","sections":[{"title":"A","items":[{"id":"1","text":"x"}]}]}')
$$, 'row-level security');
set local request.jwt.claims = '{"sub":"11111111-aaaa-0000-0000-000000000006","role":"authenticated"}';
do $$
begin
  if tests.n('select count(*) from public.qa_templates') <> 0 or tests.n('select count(*) from public.qa_records') <> 0 or tests.n('select count(*) from public.qa_itp_instances') <> 0 then
    raise exception 'TESTFAIL: another company read the QA module'; end if;
end; $$;
set local request.jwt.claims = '{"sub":"11111111-aaaa-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  if tests.n('select count(*) from public.qa_records') <> 2 then raise exception 'TESTFAIL: the office reads every record'; end if;
end; $$;

rollback;
