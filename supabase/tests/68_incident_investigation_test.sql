-- Incident investigation (README R178): opened by a manager, finished only with its three things,
-- signed off with a drawn signature and then frozen; confidential ones for managers alone; the
-- report closes only once it is signed off.
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
  ('00000000-0000-0000-ac68-000000000001', 'sup68@example.com'),
  ('00000000-0000-0000-ac68-000000000002', 'lh68@example.com'),
  ('00000000-0000-0000-ac68-000000000003', 'lab68@example.com'),
  ('00000000-0000-0000-ac68-000000000004', 'pm68@example.com'),
  ('00000000-0000-0000-ac68-000000000009', 'out68@example.com');
insert into public.profiles (id, email, full_name) values
  ('00000000-0000-0000-ac68-000000000001', 'sup68@example.com', 'Sue Pervisor'),
  ('00000000-0000-0000-ac68-000000000002', 'lh68@example.com', 'Lee Hand'),
  ('00000000-0000-0000-ac68-000000000003', 'lab68@example.com', 'Sam Labourer'),
  ('00000000-0000-0000-ac68-000000000004', 'pm68@example.com', 'Pat Manager'),
  ('00000000-0000-0000-ac68-000000000009', 'out68@example.com', 'Olive Outsider')
  on conflict (id) do nothing;
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-0000-0000-ac68-000000000001', 'Kingsbridge Civil', 'KB68'),
  ('aaaaaaaa-0000-0000-ac68-000000000002', 'Other Co', 'OT68');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-ac68-000000000001', 'aaaaaaaa-0000-0000-ac68-000000000001', 'Northern', 'C068'),
  ('bbbbbbbb-0000-0000-ac68-000000000002', 'aaaaaaaa-0000-0000-ac68-000000000002', 'Elsewhere', 'X068');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-ac68-000000000001', '00000000-0000-0000-ac68-000000000001', 'supervisor'),
  ('bbbbbbbb-0000-0000-ac68-000000000001', '00000000-0000-0000-ac68-000000000002', 'leading_hand'),
  ('bbbbbbbb-0000-0000-ac68-000000000001', '00000000-0000-0000-ac68-000000000003', 'labourer'),
  ('bbbbbbbb-0000-0000-ac68-000000000001', '00000000-0000-0000-ac68-000000000004', 'pm'),
  ('bbbbbbbb-0000-0000-ac68-000000000002', '00000000-0000-0000-ac68-000000000009', 'admin');

-- The report, made by the leading hand.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac68-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into public.incidents (id, project_id, kind, occurred_at, description, reported_by)
values ('dddddddd-0000-0000-ac68-000000000001', 'bbbbbbbb-0000-0000-ac68-000000000001', 'injury', now() - interval '3 hours',
        'Hand caught between the bucket and the trench shield', '00000000-0000-0000-ac68-000000000002');

-- 1. The leading hand cannot open an investigation.
select tests.expect_error($q$
  insert into public.incident_investigations (incident_id, project_id, opened_by)
  values ('dddddddd-0000-0000-ac68-000000000001', 'bbbbbbbb-0000-0000-ac68-000000000001', '00000000-0000-0000-ac68-000000000002')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  1 the crew do not open investigations'; end $$;

-- 2. The supervisor opens it: stamped, the report moves to investigating, the job is the report's whatever was typed.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac68-000000000001","role":"authenticated"}', true);
insert into public.incident_investigations (id, incident_id, project_id, opened_by, due_on, investigator_id, investigator_name, status, finished_at)
values ('eeeeeeee-0000-0000-ac68-000000000001', 'dddddddd-0000-0000-ac68-000000000001', 'bbbbbbbb-0000-0000-ac68-000000000002',
        '00000000-0000-0000-ac68-000000000004', current_date + 7, '00000000-0000-0000-ac68-000000000004', '  Pat Manager ', 'finished', now());
do $$ declare v record; begin
  select * into v from public.incident_investigations where id = 'eeeeeeee-0000-0000-ac68-000000000001';
  assert v.opened_by = '00000000-0000-0000-ac68-000000000001', 'opened_by was not the caller';
  assert v.project_id = 'bbbbbbbb-0000-0000-ac68-000000000001', 'the job was not forced to the report''s';
  assert v.status = 'open' and v.finished_at is null, 'born open';
  assert v.investigator_name = 'Pat Manager', 'name not trimmed';
  assert (select status from public.incidents where id = 'dddddddd-0000-0000-ac68-000000000001') = 'investigating', 'report did not move to investigating';
  raise notice 'PASS  2 opened by the supervisor, stamped, report under investigation';
end $$;

-- 3. One per report; the investigator is on the job.
select tests.expect_error($q$
  insert into public.incident_investigations (incident_id, project_id, opened_by)
  values ('dddddddd-0000-0000-ac68-000000000001', 'bbbbbbbb-0000-0000-ac68-000000000001', '00000000-0000-0000-ac68-000000000001')
$q$, 'one_per_report');
select tests.expect_error($q$
  update public.incident_investigations set investigator_id = '00000000-0000-0000-ac68-000000000009' where id = 'eeeeeeee-0000-0000-ac68-000000000001'
$q$, 'someone on the job');
do $$ begin raise notice 'PASS  3 one investigation per report; the investigator is on the job'; end $$;

-- 4. It does not finish without a summary, findings and a root cause.
select tests.expect_error($q$
  update public.incident_investigations set status = 'finished', summary = 'Bucket swung while the shield was being set' where id = 'eeeeeeee-0000-0000-ac68-000000000001'
$q$, 'at least one root cause');
-- The company's own list, kept by the office; the crew cannot write it.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac68-000000000004","role":"authenticated"}', true);
insert into public.org_incident_causes (org_id, kind, key, label, created_by)
values ('aaaaaaaa-0000-0000-ac68-000000000001', 'root_cause', 'exclusion_zone', 'No exclusion zone around the excavator', '00000000-0000-0000-ac68-000000000004');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac68-000000000002","role":"authenticated"}', true);
select tests.expect_error($q$
  insert into public.org_incident_causes (org_id, kind, key, label) values ('aaaaaaaa-0000-0000-ac68-000000000001', 'root_cause', 'x_y', 'Nope')
$q$, 'row-level security');
select tests.expect_error($q$
  insert into public.incident_causes (investigation_id, kind, cause_key, cause_label, created_by)
  values ('eeeeeeee-0000-0000-ac68-000000000001', 'root_cause', 'exclusion_zone', 'No exclusion zone around the excavator', '00000000-0000-0000-ac68-000000000002')
$q$, 'row-level security');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac68-000000000001","role":"authenticated"}', true);
insert into public.incident_causes (id, investigation_id, kind, cause_key, cause_label, detail, created_by)
values ('cccccccc-0000-0000-ac68-000000000001', 'eeeeeeee-0000-0000-ac68-000000000001', 'root_cause', 'exclusion_zone', ' No exclusion zone around the excavator ', '  ', '00000000-0000-0000-ac68-000000000002');
insert into public.incident_causes (investigation_id, kind, cause_key, cause_label, created_by)
values ('eeeeeeee-0000-0000-ac68-000000000001', 'contributing_factor', 'time_pressure', 'Time pressure', '00000000-0000-0000-ac68-000000000001');
select tests.expect_error($q$
  insert into public.incident_causes (investigation_id, kind, cause_key, cause_label, created_by)
  values ('eeeeeeee-0000-0000-ac68-000000000001', 'root_cause', 'exclusion_zone', 'Again', '00000000-0000-0000-ac68-000000000001')
$q$, 'incident_causes_once');
insert into public.incident_whys (investigation_id, seq, why, created_by) values
  ('eeeeeeee-0000-0000-ac68-000000000001', 1, 'Why was the hand there? Setting the shield by hand.', '00000000-0000-0000-ac68-000000000001'),
  ('eeeeeeee-0000-0000-ac68-000000000001', 2, 'Why by hand? No lifting lugs on the shield.', '00000000-0000-0000-ac68-000000000001');
select tests.expect_error($q$
  insert into public.incident_whys (investigation_id, seq, why, created_by) values ('eeeeeeee-0000-0000-ac68-000000000001', 2, 'twice', '00000000-0000-0000-ac68-000000000001')
$q$, 'incident_whys_seq');
select tests.expect_error($q$
  insert into public.incident_whys (investigation_id, seq, why, created_by) values ('eeeeeeee-0000-0000-ac68-000000000001', 3, '   ', '00000000-0000-0000-ac68-000000000001')
$q$, 'check');
do $$ declare c record; begin
  select * into c from public.incident_causes where id = 'cccccccc-0000-0000-ac68-000000000001';
  assert c.cause_label = 'No exclusion zone around the excavator' and c.detail is null, 'cause not tidied';
  assert c.created_by = '00000000-0000-0000-ac68-000000000001', 'created_by was not the caller';
  raise notice 'PASS  4 causes from the company list and the whys, written by managers, tidied and stamped';
end $$;

-- 5. Finish, reopen, finish again; signing off needs finished, a name and a signature in the report's folder.
select tests.expect_error($q$
  update public.incident_investigations set status = 'finished', summary = 'Bucket swung while the shield was being set' where id = 'eeeeeeee-0000-0000-ac68-000000000001'
$q$, 'summary, findings');
update public.incident_investigations set status = 'finished', summary = 'Bucket swung while the shield was being set', findings = 'The shield was being guided by hand inside the swing radius.'
 where id = 'eeeeeeee-0000-0000-ac68-000000000001';
do $$ declare v record; begin
  select * into v from public.incident_investigations where id = 'eeeeeeee-0000-0000-ac68-000000000001';
  assert v.status = 'finished' and v.finished_at is not null and v.finished_by = '00000000-0000-0000-ac68-000000000001', 'finish not stamped';
end $$;
update public.incident_investigations set status = 'open' where id = 'eeeeeeee-0000-0000-ac68-000000000001';
do $$ begin
  assert (select finished_at from public.incident_investigations where id = 'eeeeeeee-0000-0000-ac68-000000000001') is null, 'reopen did not clear the finish';
end $$;
select tests.expect_error($q$
  update public.incident_investigations set status = 'signed_off', signed_name = 'Sue Pervisor', signature_path = 'bbbbbbbb-0000-0000-ac68-000000000001/incident/dddddddd-0000-0000-ac68-000000000001/sig.png' where id = 'eeeeeeee-0000-0000-ac68-000000000001'
$q$, 'finish the investigation before');
update public.incident_investigations set status = 'finished' where id = 'eeeeeeee-0000-0000-ac68-000000000001';
select tests.expect_error($q$
  update public.incident_investigations set status = 'signed_off', signature_path = 'bbbbbbbb-0000-0000-ac68-000000000001/incident/dddddddd-0000-0000-ac68-000000000001/sig.png' where id = 'eeeeeeee-0000-0000-ac68-000000000001'
$q$, 'name of who signed');
select tests.expect_error($q$
  update public.incident_investigations set status = 'signed_off', signed_name = 'Sue Pervisor', signature_path = 'bbbbbbbb-0000-0000-ac68-000000000002/incident/dddddddd-0000-0000-ac68-000000000001/sig.png' where id = 'eeeeeeee-0000-0000-ac68-000000000001'
$q$, 'drawn signature');
-- 6. The report will not close while the investigation stands open.
select tests.expect_error($q$
  update public.incidents set status = 'closed' where id = 'dddddddd-0000-0000-ac68-000000000001'
$q$, 'investigation is signed off');
do $$ begin raise notice 'PASS  5-6 finish, reopen, the sign-off rules; the report waits for the sign-off'; end $$;

-- 7. Confidential: the leading hand reads it when it is not, and nothing when it is; the labourer never.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac68-000000000002","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.incident_investigations where incident_id = 'dddddddd-0000-0000-ac68-000000000001') = 1, 'leading hand should read an ordinary investigation';
  assert (select count(*) from public.incident_causes) = 2 and (select count(*) from public.incident_whys) = 2, 'and its parts';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac68-000000000001","role":"authenticated"}', true);
update public.incident_investigations set confidential = true where id = 'eeeeeeee-0000-0000-ac68-000000000001';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac68-000000000002","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.incident_investigations) = 0, 'leading hand read a confidential investigation';
  assert (select count(*) from public.incident_causes) = 0 and (select count(*) from public.incident_whys) = 0, 'or its parts';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac68-000000000004","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.incident_investigations) = 1, 'the PM manages incidents and reads it';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac68-000000000001","role":"authenticated"}', true);
update public.incident_investigations set confidential = false where id = 'eeeeeeee-0000-0000-ac68-000000000001';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac68-000000000003","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.incident_investigations) = 0, 'the labourer reads no investigation';
  assert (select count(*) from public.org_incident_causes) = 1, 'the company list itself is readable by every member';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac68-000000000009","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.incident_investigations) = 0, 'an outsider reads nothing';
  assert (select count(*) from public.org_incident_causes) = 0, 'nor the other company''s list';
end $$;
do $$ begin raise notice 'PASS  7 confidential for managers alone; the labourer and the outsider read none'; end $$;

-- 8. Signed off: stamped, then frozen entirely — the row, its causes and its whys — for anyone, the service role included.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac68-000000000001","role":"authenticated"}', true);
update public.incident_investigations set status = 'signed_off', signed_name = ' Sue Pervisor ',
  signature_path = 'bbbbbbbb-0000-0000-ac68-000000000001/incident/dddddddd-0000-0000-ac68-000000000001/investigation-sig.png', signed_off_at = '2000-01-01'
 where id = 'eeeeeeee-0000-0000-ac68-000000000001';
do $$ declare v record; begin
  select * into v from public.incident_investigations where id = 'eeeeeeee-0000-0000-ac68-000000000001';
  assert v.status = 'signed_off' and v.signed_off_by = '00000000-0000-0000-ac68-000000000001' and v.signed_off_at > now() - interval '1 minute', 'sign-off not stamped by the DB';
  assert v.signed_name = 'Sue Pervisor', 'signed name not trimmed';
  assert v.finished_at is not null, 'the finish stamp was lost at sign-off';
end $$;
reset role;
select tests.expect_error($q$ update public.incident_investigations set summary = 'Changed' where id = 'eeeeeeee-0000-0000-ac68-000000000001' $q$, 'signed-off investigation is frozen');
select tests.expect_error($q$ update public.incident_investigations set status = 'open' where id = 'eeeeeeee-0000-0000-ac68-000000000001' $q$, 'signed-off investigation is frozen');
select tests.expect_error($q$ delete from public.incident_causes where id = 'cccccccc-0000-0000-ac68-000000000001' $q$, 'signed-off investigation is frozen');
select tests.expect_error($q$ insert into public.incident_whys (investigation_id, seq, why, created_by) values ('eeeeeeee-0000-0000-ac68-000000000001', 3, 'late', '00000000-0000-0000-ac68-000000000001') $q$, 'signed-off investigation is frozen');
select tests.expect_error($q$ delete from public.incident_investigations where id = 'eeeeeeee-0000-0000-ac68-000000000001' $q$, 'never removed');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac68-000000000001","role":"authenticated"}', true);
-- 9. Now the report closes.
update public.incidents set status = 'closed' where id = 'dddddddd-0000-0000-ac68-000000000001';
do $$ begin
  assert (select status from public.incidents where id = 'dddddddd-0000-0000-ac68-000000000001') = 'closed', 'report did not close after sign-off';
  raise notice 'PASS  8-9 signed off, frozen for everyone; the report closes';
end $$;
-- 10. A closed report takes no investigation.
insert into public.incidents (id, project_id, kind, occurred_at, description, reported_by)
values ('dddddddd-0000-0000-ac68-000000000002', 'bbbbbbbb-0000-0000-ac68-000000000001', 'near_miss', now() - interval '1 hour', 'Reversing truck, nobody hurt', '00000000-0000-0000-ac68-000000000001');
update public.incidents set status = 'closed' where id = 'dddddddd-0000-0000-ac68-000000000002';
select tests.expect_error($q$
  insert into public.incident_investigations (incident_id, project_id, opened_by)
  values ('dddddddd-0000-0000-ac68-000000000002', 'bbbbbbbb-0000-0000-ac68-000000000001', '00000000-0000-0000-ac68-000000000001')
$q$, 'closed report takes no investigation');
do $$ begin raise notice 'PASS  10 a closed report takes no investigation'; end $$;

rollback;
